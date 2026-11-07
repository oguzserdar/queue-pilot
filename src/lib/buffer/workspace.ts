/**
 * @fileoverview Two reads about the person's Buffer workspace (API reference, read 5 Nov 2026; both Experimental):
 *
 * - selectableTeamMembers: the teammates the person may pick, for example to @mention in a Note. Buffer added it on
 *   4 Nov to back the Notes mention picker. Selecting someone does not authorize a mention: Buffer checks every
 *   mentioned account when the Note is written.
 * - configuration: each connected channel's real content rules (such as the character limit per content type) and
 *   whether the connection may post, mention or comment right now.
 *
 * Why Queue Pilot reads them: an assistant can hand work to a real teammate in a Note, and the writer can check a draft
 * against the channel's own limits instead of a hard-coded table. Both show a second interface built on Buffer's own
 * source of truth.
 */
import { bufferQuery } from "./client";
import { pageOf, readPages, type Paged } from "./paging";
import { POST_FIELDS, type Post } from "./queries";

type Run = typeof bufferQuery;

/** A teammate as a picker shows them. */
export type TeamMember = { id: string; name: string | null; email: string; avatar: string; isLocked: boolean; urn: string };

/** Buffer allows 1 to 100 per page. */
const MEMBER_PAGE = 100;
const MEMBER_PAGES = 3;

/**
 * The teammates the person may select, ordered by display name, up to a page budget. Buffer pages a live list, so a
 * member renamed while paging can arrive twice; pages are merged by id.
 *
 * @param token - The person's Buffer access token
 * @param scope - Exactly one: the organization, or a channel (members who can read Notes on it)
 * @param opts - Optional case-insensitive match on name or email, and a cursor to continue from
 * @returns The members read, whether more exist, and the cursor to continue
 */
export async function listTeamMembers(token: string, scope: { organizationId: string } | { channelId: string }, opts: { search?: string; after?: string | null } = {}, run: Run = bufferQuery): Promise<Paged<TeamMember>> {
  const search = opts.search?.trim();
  const read = await readPages(async (after) => {
    const data = await run<{ selectableTeamMembers: { edges: { node: TeamMember }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(token,
      `query TeamMembers($input: SelectableTeamMembersInput!, $first: Int, $after: String) { selectableTeamMembers(input: $input, first: $first, after: $after) { ${MEMBERS_PAGE} } }`,
      { input: { scope, ...(search ? { search } : {}) }, first: MEMBER_PAGE, after });
    return pageOf(data.selectableTeamMembers);
  }, MEMBER_PAGES, opts.after ?? null);
  return { ...read, items: [...new Map(read.items.map((m) => [m.id, m])).values()] };
}

const MEMBERS_PAGE = "edges { node { id name email avatar isLocked urn } } pageInfo { hasNextPage endCursor }";

/** Most pages of teammates read while looking for chosen people: Buffer counts up to 1,000 authorized users. */
const FIND_PAGES = 10;

/**
 * The chosen teammates in one scope, reading pages only until every one is found or Buffer has no more. Picking
 * someone does not authorize a mention: Buffer checks each mentioned account when the note is written.
 *
 * @param ids - Account ids (or URNs, with `by`) to find
 * @param start - A first page already read, so it is not read again
 * @param by - Match on the account id (connector tools) or the URN (the app's picker)
 * @returns The members found, in the order asked; ids not found are left out
 */
export async function findTeamMembers(token: string, scope: { organizationId: string } | { channelId: string }, ids: string[], run: Run = bufferQuery, start?: { nodes: TeamMember[]; hasNextPage: boolean; endCursor: string | null }, by: "id" | "urn" = "id"): Promise<TeamMember[]> {
  const found = new Map<string, TeamMember>();
  const keep = (nodes: TeamMember[]) => { for (const m of nodes) if (ids.includes(m[by])) found.set(m[by], m); };
  let page = start ?? null;
  if (page) keep(page.nodes);
  for (let i = page ? 1 : 0; i < FIND_PAGES && found.size < new Set(ids).size; i++) {
    if (page && (!page.hasNextPage || !page.endCursor)) break;
    const after = page?.endCursor ?? null;
    const data = await run<{ selectableTeamMembers: { edges: { node: TeamMember }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(token,
      `query TeamMembers($input: SelectableTeamMembersInput!, $first: Int, $after: String) { selectableTeamMembers(input: $input, first: $first, after: $after) { ${MEMBERS_PAGE} } }`,
      { input: { scope }, first: MEMBER_PAGE, after });
    page = pageOf(data.selectableTeamMembers);
    keep(page.nodes);
  }
  return ids.flatMap((id) => found.get(id) ?? []);
}

/**
 * A post as Buffer has it now and, for a note that mentions people, the first page of its channel's teammates, in one
 * request: Buffer's guide says one query may carry several top-level fields
 * (developers.buffer.com/guides/efficient-api-usage). Nothing more is read for a post that is gone or no longer a
 * draft, since the note is refused. The channel comes from the saved copy; when the live post is on another channel,
 * the chosen people are looked up in that channel instead.
 *
 * @param channelId - The post's channel in the saved copy
 * @param chosen - Account ids the note mentions
 * @returns The post (null when Buffer no longer has it) and the chosen teammates found on its channel
 */
export async function readPostWithTeam(token: string, postId: string, channelId: string, chosen: string[], run: Run = bufferQuery): Promise<{ post: Post | null; members: TeamMember[] }> {
  type Conn = { edges: { node: TeamMember }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
  const data = await run<{ post: Post | null; team: Conn }>(token,
    `query PostWithTeam($post: PostInput!, $team: SelectableTeamMembersInput!, $first: Int) { post(input: $post) { ${POST_FIELDS} } team: selectableTeamMembers(input: $team, first: $first) { ${MEMBERS_PAGE} } }`,
    { post: { id: postId }, team: { scope: { channelId } }, first: MEMBER_PAGE });
  const post = data.post && data.post.id === postId ? data.post : null;
  if (!post || post.status !== "draft") return { post, members: [] };
  if (post.channelId !== channelId) return { post, members: await findTeamMembers(token, { channelId: post.channelId }, chosen, run) };
  return { post, members: await findTeamMembers(token, { channelId }, chosen, run, pageOf(data.team)) };
}

/** Whether a channel's connection may use one feature now, with Buffer's reason when it may not. */
export type FeatureStatus = { feature: string; status: string; reason: string | null };

/** One validation rule Queue Pilot uses: a length cap or a count bound on a content property. */
export type ContentRule =
  | { kind: "length"; property: string; maxLength: number }
  | { kind: "count"; property: string; min: number | null; max: number | null };

/** One connected channel's configuration, reduced to what drafting needs. */
export type ChannelSettings = {
  channelId: string;
  service: string;
  channelType: string;
  features: FeatureStatus[];
  /** Rules per content type (post, story, reel, comment). */
  content: { types: string[]; rules: ContentRule[] }[];
};

type RawRule = { __typename: string; property: string; maxLength?: number; min?: number | null; max?: number | null };
type RawChannel = { channelId: string; service: string; channelType: string; authorizationStatus: FeatureStatus[]; content: { configurationContentTypes: string[]; rules: RawRule[] }[] };

/** The configuration query. Other rule kinds (format, duration, file size) are skipped until a caller needs them. */
export const CONFIGURATION_QUERY =
  "query Configuration($input: ConfigurationInput!) { configuration(input: $input) { channels { channelId service channelType authorizationStatus { feature status reason } content { configurationContentTypes rules { __typename property ... on LengthRule { maxLength } ... on CountRule { min max } } } } } }";

/**
 * The real settings of every connected channel the person can view in one organization.
 *
 * @param token - The person's Buffer access token
 * @param organizationId - The organization
 * @returns One entry per channel
 */
export async function channelSettings(token: string, organizationId: string, run: Run = bufferQuery): Promise<ChannelSettings[]> {
  const data = await run<{ configuration: { channels: RawChannel[] } }>(token, CONFIGURATION_QUERY, { input: { organizationId } });
  return data.configuration.channels.map((c) => ({
    channelId: c.channelId,
    service: c.service,
    channelType: c.channelType,
    features: c.authorizationStatus,
    content: c.content.map((k) => ({
      types: k.configurationContentTypes,
      rules: k.rules.flatMap((r): ContentRule[] =>
        r.__typename === "LengthRule" && typeof r.maxLength === "number" ? [{ kind: "length", property: r.property, maxLength: r.maxLength }]
        : r.__typename === "CountRule" ? [{ kind: "count", property: r.property, min: r.min ?? null, max: r.max ?? null }]
        : []),
    })),
  }));
}

/** Whether the channel may post now: only an explicit entry from Buffer counts; no entry means Buffer did not say. */
export type PostingState = { state: "ok" } | { state: "blocked"; status: string; reason: string | null } | { state: "unknown" };

/**
 * The channel's posting authorization as Buffer reports it. Buffer gives one entry per authorization-gated feature, so
 * a missing posting entry is "not reported", never "fine".
 *
 * @param settings - One channel's settings
 * @returns ok, blocked with Buffer's status and reason, or unknown
 */
export function postingState(settings: ChannelSettings): PostingState {
  const entry = settings.features.find((f) => f.feature === "posting");
  if (!entry) return { state: "unknown" };
  return entry.status === "ok" ? { state: "ok" } : { state: "blocked", status: entry.status, reason: entry.reason };
}

/**
 * A channel's character limit for post text, from its own configuration.
 *
 * @param settings - One channel's settings
 * @returns The post text cap, or null when Buffer gives none
 */
export function postTextLimit(settings: ChannelSettings): number | null {
  const entry = settings.content.find((k) => k.types.includes("post"));
  const rule = entry?.rules.find((r): r is Extract<ContentRule, { kind: "length" }> => r.kind === "length" && r.property === "text");
  return rule?.maxLength ?? null;
}

/**
 * Each account's post text limit, read from Buffer's channel configuration. A failed read gives an empty map, so the
 * caller falls back to the built-in table instead of failing the check.
 *
 * @param token - The person's Buffer access token
 * @param organizationIds - The organizations to read
 * @returns Channel id to its post text limit, for channels where Buffer states one
 */
export async function textLimits(token: string, organizationIds: string[], run: Run = bufferQuery): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (const org of new Set(organizationIds)) {
    const settings = await channelSettings(token, org, run).catch(() => []);
    for (const c of settings) { const cap = postTextLimit(c); if (cap) out.set(c.channelId, cap); }
  }
  return out;
}
