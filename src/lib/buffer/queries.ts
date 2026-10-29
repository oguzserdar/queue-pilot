/**
 * Typed read queries against the Buffer GraphQL API. Field names and enums follow https://developers.buffer.com/reference.html:
 * channels come from channels(input: { organizationId }), posting slots are ScheduleV2 { day, paused, times: "HH:MM" }
 * in the channel's own timezone, and posts are a Relay connection filtered by dueAt.
 */
import { bufferQuery } from "./client";

export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export type PostStatus = "draft" | "error" | "needs_approval" | "scheduled" | "sending" | "sent";

export type Channel = {
  id: string;
  name: string;
  service: string;
  timezone: string;
  isDisconnected: boolean;
  isLocked: boolean;
  isQueuePaused: boolean;
  postingSchedule: { day: DayOfWeek; paused: boolean; times: string[] }[];
  /** The organization the channel was listed under; createContentItem needs it. Absent on older snapshots. */
  organizationId?: string;
};

export type Post = {
  id: string;
  channelId: string;
  status: PostStatus;
  text: string;
  dueAt: string | null;
  sentAt: string | null;
  externalLink: string | null;
  error: { message: string; supportUrl: string | null } | null;
  /** Media on the post; optional because snapshots saved before this field existed lack it. */
  assets?: { type: "image" | "video" | "document"; mimeType: string; source: string }[];
  /** "notification" posts are reminders the person publishes by hand; Buffer does not publish them. */
  schedulingType?: "automatic" | "notification" | null;
  /** For reminders: "markedAsPublished" once the person says they posted it. */
  notificationStatus?: "notified" | "markedAsPublished" | null;
  /** How the post was created: "api" for drafts an app saved, "buffer" for ones the person wrote in Buffer. Optional because older snapshots lack it. */
  via?: "api" | "buffer" | "network";
};

type Query = typeof bufferQuery;

/** The signed-in Buffer account: email, its own timezone (set in Buffer's preferences) and the ids of its organizations. */
export async function getAccount(token: string, q: Query = bufferQuery): Promise<{ email: string; timezone: string | null; organizationIds: string[] }> {
  const { account } = await q<{ account: { email: string; timezone?: string | null; organizations: { id: string }[] } }>(token, "{ account { email timezone organizations { id } } }");
  return { email: account.email, timezone: account.timezone || null, organizationIds: account.organizations.map((o) => o.id) };
}

/** The ids of every organization the signed-in Buffer account belongs to. */
export async function listOrganizationIds(token: string, q: Query = bufferQuery): Promise<string[]> {
  const { account } = await q<{ account: { organizations: { id: string }[] } }>(token, "{ account { organizations { id } } }");
  return account.organizations.map((o) => o.id);
}

export const CHANNEL_FIELDS = "id name service timezone isDisconnected isLocked isQueuePaused postingSchedule { day paused times }";

/** Every channel in one organization, with its posting slots and whether it can post. */
export async function listChannels(token: string, organizationId: string, q: Query = bufferQuery): Promise<Channel[]> {
  const data = await q<{ channels: Channel[] }>(
    token,
    `query ($id: OrganizationId!) { channels(input: { organizationId: $id }) { ${CHANNEL_FIELDS} } }`,
    { id: organizationId },
  );
  return data.channels.map((c) => ({ ...c, organizationId }));
}

export const POST_FIELDS = "id channelId status text dueAt sentAt externalLink error { message supportUrl } assets { type mimeType source } schedulingType notificationStatus via";
const PAGE_SIZE = 50;
const MAX_PAGES = 10;

/**
 * Posts in one organization due between start and end (inclusive), following pagination.
 * Stops after MAX_PAGES and reports it, so one huge account cannot spend the shared per-app rate limit.
 */
export async function listPostsDue(
  token: string,
  organizationId: string,
  range: { start: string; end: string },
  q: Query = bufferQuery,
): Promise<{ posts: Post[]; truncated: boolean }> {
  const posts: Post[] = [];
  let after: string | null = null;
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: { posts: { edges: { node: Post }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await q(
      token,
      `query ($input: PostsInput!, $first: Int, $after: String) {
        posts(input: $input, first: $first, after: $after) { edges { node { ${POST_FIELDS} } } pageInfo { hasNextPage endCursor } }
      }`,
      {
        input: { organizationId, filter: { dueAt: { start: range.start, end: range.end } }, sort: [{ field: "dueAt", direction: "asc" }] },
        first: PAGE_SIZE,
        after,
      },
    );
    posts.push(...data.posts.edges.map((e) => e.node));
    if (!data.posts.pageInfo.hasNextPage || !data.posts.pageInfo.endCursor) return { posts, truncated: false };
    after = data.posts.pageInfo.endCursor;
  }
  return { posts, truncated: true };
}

/** A sent post and the notes people wrote on it, for learning first rules (src/lib/day-one-rules.ts). */
export type SentPost = { id: string; channelId: string; text: string; sentAt: string | null; notes: SentNote[] };
/** A note a person wrote on a post: who wrote it (null when they left or set no name) and when. */
export type SentNote = { text: string; by: string | null; at: string | null };

/** Buffer allows up to 30 aliased queries in one request, and counts the request once (Buffer staff, 26 Oct 2026). */
export const MAX_ALIASES = 30;

/**
 * The newest sent posts of each channel, all channels in one request (one aliased query per channel), with only the
 * notes people wrote: Buffer's own and AI notes are left out.
 *
 * @param channelIds - Channels to read; at most MAX_ALIASES
 * @param perChannel - Posts per channel, newest first
 */
export async function listRecentSent(
  token: string,
  organizationId: string,
  channelIds: string[],
  perChannel = 20,
  q: Query = bufferQuery,
): Promise<SentPost[]> {
  const ids = channelIds.slice(0, MAX_ALIASES);
  if (!ids.length) return [];
  const parts = ids.map((_, i) => `c${i}: posts(input: { organizationId: $org, filter: { channelIds: [$ch${i}], status: [sent] }, sort: [{ field: dueAt, direction: desc }] }, first: ${perChannel}) { edges { node { id channelId text sentAt notes { text type createdAt author { name } } } } }`);
  const vars = Object.fromEntries([["org", organizationId], ...ids.map((id, i) => [`ch${i}`, id])]);
  const data: Record<string, { edges: { node: { id: string; channelId: string; text: string | null; sentAt: string | null; notes: { text: string; type: string; createdAt: string | null; author: { name: string | null } | null }[] | null } }[] }> = await q(
    token,
    `query ($org: OrganizationId!, ${ids.map((_, i) => `$ch${i}: ChannelId!`).join(", ")}) { ${parts.join(" ")} }`,
    vars,
  );
  return ids.flatMap((_, i) =>
    (data[`c${i}`]?.edges ?? []).map(({ node: n }) => ({
      id: n.id,
      channelId: n.channelId,
      text: n.text ?? "",
      sentAt: n.sentAt,
      notes: (n.notes ?? []).filter((x) => x.type === "userGenerated").map((x) => ({ text: x.text, by: x.author?.name ?? null, at: x.createdAt })),
    })),
  );
}
