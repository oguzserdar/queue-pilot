/**
 * @fileoverview Buffer content items (API reference, read 5 Nov 2026; Experimental, "can change without a deprecation
 * period"). A content item is one piece of content: it starts as a channel-less draft (text written once, before any
 * channel is chosen) and can later become channel-specific posts, one per channel. Reading needs posts:read, writing
 * posts:write.
 *
 * Why Queue Pilot uses them: "write once, pick channels later". The person (or their assistant) writes one draft from
 * the source, then chooses accounts and reviews each account's version against that account's rules. This shows a
 * second interface built on Buffer's own content model instead of keeping drafts somewhere else.
 *
 * Drafts only: promoting creates each post with saveToDraft: true, which Buffer documents as "saves the post as a draft
 * instead of scheduling it ... will not be published until explicitly scheduled". Scheduling stays with approve_drafts.
 * Buffer warns that a promote or delete can report a failure after it already took effect, so callers re-read the
 * item before any retry; these functions never retry on their own.
 */
import { bufferQuery } from "./client";
import { pageOf, readPages, type Paged } from "./paging";

type Run = typeof bufferQuery;

/** One post inside a content item, as drafting needs it. */
export type ItemPost = { id: string; channelId: string; status: string; text: string; dueAt: string | null };

/** A content item reduced to what Queue Pilot shows and checks. */
export type ContentItemView = {
  id: string;
  organizationId: string;
  title: string | null;
  targetDate: string | null;
  createdAt: string;
  tags: { id: string; name: string }[];
  /** What the caller may do with it, as Buffer computes it. */
  allowedActions: string[];
  /** Either the channel-less draft, or the posts made from it. */
  body: { kind: "draft"; text: string; aiAssisted: boolean; mediaCount: number } | { kind: "posts"; posts: ItemPost[] };
};

type RawItem = Omit<ContentItemView, "body"> & {
  body: { __typename: "DraftContent"; text: string; aiAssisted: boolean; assets?: { type: string }[] } | { __typename: "PostContent"; posts: ItemPost[] };
};

export const ITEM_FIELDS = "id organizationId title targetDate createdAt allowedActions tags { id name } body { __typename ... on DraftContent { text aiAssisted assets { type } } ... on PostContent { posts { id channelId status text dueAt } } }";

function view(raw: RawItem): ContentItemView {
  const body: ContentItemView["body"] = raw.body.__typename === "DraftContent"
    ? { kind: "draft", text: raw.body.text, aiAssisted: raw.body.aiAssisted, mediaCount: raw.body.assets?.length ?? 0 }
    : { kind: "posts", posts: raw.body.posts };
  return { ...raw, body };
}

/** A content-item write's outcome, with every reason Buffer gave when it refused. */
export type ItemWriteResult<T> = { ok: true; value: T } | { ok: false; message: string; errors: { message: string; channelId?: string; kind: string }[] };

type Failure = { __typename: string; message?: string; errors?: { __typename: string; message: string; channelId?: string }[] };

const refused = (r: Failure): ItemWriteResult<never> => ({
  ok: false,
  message: r.message ?? "Buffer did not make the change.",
  errors: (r.errors ?? []).map((e) => ({ message: e.message, kind: e.__typename, ...(e.channelId ? { channelId: e.channelId } : {}) })),
});

const ERRORS = "... on MutationError { message } ";
/**
 * Error selections per payload. Each failure's `errors` has its own type, and GraphQL rejects a fragment on a type that
 * cannot appear there, so one shared selection would fail even valid requests.
 */
export const FAILURE = {
  /** errors: [InvalidInputError!]! */
  createDraft: "... on CreateContentItemDraftFailure { message errors { __typename message } }",
  /** errors: [InvalidInputError!]! */
  update: "... on UpdateContentItemFailure { message errors { __typename message } }",
  /** errors: [InvalidInputError | ContentItemStateError] */
  updateDraft: "... on UpdateContentItemDraftFailure { message errors { __typename ... on MutationError { message } } }",
  /** errors: [ContentItemStateError | InvalidInputError | PostChannelNotFoundError | PostInvalidInputError | PostLimitReachedError] */
  promote: "... on PromoteContentItemDraftToPostsFailure { message errors { __typename ... on MutationError { message } ... on PostInvalidInputError { channelId } ... on PostChannelNotFoundError { channelId } ... on PostLimitReachedError { channelId } } }",
  /** errors: [PostNotDeletableError!]! */
  remove: "... on DeleteContentItemFailure { message errors { __typename message channelId } }",
};

/** Buffer rejects pages over 100. */
const PAGE = 50;
const MAX_PAGES = 2;

/**
 * The organization's content items, newest first, up to a page budget.
 *
 * @param token - The person's Buffer access token
 * @param organizationId - The organization
 * @param opts - Only channel-less drafts ("draftContent") or only items with posts ("postContent"); a cursor to continue
 * @returns The items read, whether more exist, and the cursor to continue
 */
export async function listContentItems(token: string, organizationId: string, opts: { status?: "draftContent" | "postContent"; after?: string | null } = {}, run: Run = bufferQuery): Promise<Paged<ContentItemView>> {
  const read = await readPages(async (after) => {
    const data = await run<{ contentItems: { edges: { node: RawItem }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } }>(token,
      `query ContentItems($input: ContentItemsInput!, $first: Int, $after: String) { contentItems(input: $input, first: $first, after: $after) { edges { node { ${ITEM_FIELDS} } } pageInfo { hasNextPage endCursor } } }`,
      { input: { organizationId, ...(opts.status ? { filter: { contentStatus: opts.status } } : {}) }, first: PAGE, after });
    return pageOf(data.contentItems);
  }, MAX_PAGES, opts.after ?? null);
  return { ...read, items: read.items.map(view) };
}

/**
 * One content item by id. Buffer errors when it does not exist; that error reaches the caller.
 *
 * @param token - The person's Buffer access token
 * @param id - The content item
 * @returns The item
 */
export async function getContentItem(token: string, id: string, run: Run = bufferQuery): Promise<ContentItemView> {
  const data = await run<{ contentItem: RawItem }>(token, `query ContentItem($input: ContentItemInput!) { contentItem(input: $input) { ${ITEM_FIELDS} } }`, { input: { id } });
  return view(data.contentItem);
}

/**
 * Saves one channel-less draft, marked as written with AI. The correlation id makes a retry return the first item
 * instead of creating a second one.
 *
 * @param token - The person's Buffer access token
 * @param organizationId - The organization that will own it
 * @param draft - The text, an optional title and planning date (the date schedules nothing), and a client UUID
 * @returns The new item, or Buffer's refusal
 */
export async function createChannelLessDraft(token: string, organizationId: string, draft: { text: string; title?: string; targetDate?: string; correlationId: string }, run: Run = bufferQuery): Promise<ItemWriteResult<ContentItemView>> {
  const data = await run<{ createContentItemDraft: Failure & { contentItem?: RawItem } }>(token,
    `mutation CreateContentItemDraft($input: CreateContentItemDraftInput!) { createContentItemDraft(input: $input) { __typename ... on CreateContentItemDraftSuccess { contentItem { ${ITEM_FIELDS} } } ${FAILURE.createDraft} } }`,
    { input: { organizationId, correlationId: draft.correlationId, draft: { text: draft.text, aiAssisted: true, assets: [] }, ...(draft.title ? { title: draft.title } : {}), ...(draft.targetDate ? { targetDate: draft.targetDate } : {}) } });
  const r = data.createContentItemDraft;
  return r.__typename === "CreateContentItemDraftSuccess" && r.contentItem ? { ok: true, value: view(r.contentItem) } : refused(r);
}

/**
 * Replaces a channel-less draft's text in full. Only valid while the item is still a draft.
 *
 * @param token - The person's Buffer access token
 * @param id - The content item
 * @param text - The new text
 * @returns The item after the change, or Buffer's refusal (for example, it already holds posts)
 */
export async function updateChannelLessDraft(token: string, id: string, text: string, run: Run = bufferQuery): Promise<ItemWriteResult<ContentItemView>> {
  const data = await run<{ updateContentItemDraft: Failure & { contentItem?: RawItem } }>(token,
    `mutation UpdateContentItemDraft($input: UpdateContentItemDraftInput!) { updateContentItemDraft(input: $input) { __typename ... on UpdateContentItemDraftSuccess { contentItem { ${ITEM_FIELDS} } } ${FAILURE.updateDraft} } }`,
    { input: { id, draft: { text, aiAssisted: true, assets: [] } } });
  const r = data.updateContentItemDraft;
  return r.__typename === "UpdateContentItemDraftSuccess" && r.contentItem ? { ok: true, value: view(r.contentItem) } : refused(r);
}

/** One account's version of the draft. Without a time it stays an unscheduled draft. */
export type PromotedPost = { channelId: string; text: string; dueAt?: string };

/** The post inputs a promote sends: every one a Buffer draft, marked as written with AI. */
export function promotePostInputs(posts: PromotedPost[]) {
  return posts.map((p) => ({
    channelId: p.channelId,
    text: p.text,
    ...(p.dueAt ? { dueAt: p.dueAt, mode: "customScheduled" } : { mode: "addToQueue" }),
    schedulingType: "automatic",
    saveToDraft: true,
    needsApproval: false,
    assets: [],
    aiAssisted: true,
  }));
}

/**
 * Turns a channel-less draft into one draft post per chosen account. One-way. If any post fails validation, none are
 * created. A reported failure may still have taken effect, so re-read the item before retrying.
 *
 * @param token - The person's Buffer access token
 * @param id - The content item
 * @param posts - At most one per channel, each with that account's text
 * @returns The item with its draft posts, or every reason Buffer gave
 */
export async function promoteToDraftPosts(token: string, id: string, posts: PromotedPost[], run: Run = bufferQuery): Promise<ItemWriteResult<ContentItemView>> {
  const data = await run<{ promoteContentItemDraftToPosts: Failure & { contentItem?: RawItem } }>(token,
    `mutation PromoteContentItemDraftToPosts($input: PromoteContentItemDraftToPostsInput!) { promoteContentItemDraftToPosts(input: $input) { __typename ... on PromoteContentItemDraftToPostsSuccess { contentItem { ${ITEM_FIELDS} } } ${FAILURE.promote} } }`,
    { input: { id, posts: promotePostInputs(posts) } });
  const r = data.promoteContentItemDraftToPosts;
  return r.__typename === "PromoteContentItemDraftToPostsSuccess" && r.contentItem ? { ok: true, value: view(r.contentItem) } : refused(r);
}

/**
 * Changes a content item's title or planning date. Omitted fields keep their value; null clears one.
 *
 * @param token - The person's Buffer access token
 * @param id - The content item
 * @param change - The new title and/or target date
 * @returns The item after the change, or Buffer's refusal
 */
export async function updateContentItem(token: string, id: string, change: { title?: string | null; targetDate?: string | null }, run: Run = bufferQuery): Promise<ItemWriteResult<ContentItemView>> {
  const data = await run<{ updateContentItem: Failure & { contentItem?: RawItem } }>(token,
    `mutation UpdateContentItem($input: UpdateContentItemInput!) { updateContentItem(input: $input) { __typename ... on UpdateContentItemSuccess { contentItem { ${ITEM_FIELDS} } } ${FAILURE.update} } }`,
    { input: { id, ...change } });
  const r = data.updateContentItem;
  return r.__typename === "UpdateContentItemSuccess" && r.contentItem ? { ok: true, value: view(r.contentItem) } : refused(r);
}

/**
 * Deletes a content item, every post made from it, and the team notes on them. All or nothing: a post that is
 * publishing or published blocks the whole delete, and Buffer names each blocked channel.
 *
 * @param token - The person's Buffer access token
 * @param id - The content item
 * @returns ok, or every blocked channel with Buffer's reason
 */
export async function deleteContentItem(token: string, id: string, run: Run = bufferQuery): Promise<ItemWriteResult<null>> {
  const data = await run<{ deleteContentItem: Failure }>(token,
    `mutation DeleteContentItem($input: DeleteContentItemInput!) { deleteContentItem(input: $input) { __typename ... on EmptySuccess { _empty } ${FAILURE.remove} } }`,
    { input: { id } });
  const r = data.deleteContentItem;
  return r.__typename === "EmptySuccess" ? { ok: true, value: null } : refused(r);
}

/**
 * Links an existing post to a content item (same organization). Creates no post.
 *
 * @param token - The person's Buffer access token
 * @param id - The content item
 * @param postId - The post
 * @returns The item after the change, or Buffer's refusal
 */
export async function addPostToContentItem(token: string, id: string, postId: string, run: Run = bufferQuery): Promise<ItemWriteResult<ContentItemView>> {
  const data = await run<{ addPostToContentItem: Failure & { contentItem?: RawItem } }>(token,
    `mutation AddPostToContentItem($input: AddPostToContentItemInput!) { addPostToContentItem(input: $input) { __typename ... on AddPostToContentItemSuccess { contentItem { ${ITEM_FIELDS} } } ${ERRORS}} }`,
    { input: { id, postId } });
  const r = data.addPostToContentItem;
  return r.__typename === "AddPostToContentItemSuccess" && r.contentItem ? { ok: true, value: view(r.contentItem) } : refused(r);
}

/**
 * Unlinks a post from its content item. The post keeps its channel, schedule, text, status and tags.
 *
 * @param token - The person's Buffer access token
 * @param id - The content item
 * @param postId - The post
 * @returns The item after the change, or Buffer's refusal
 */
export async function removePostFromContentItem(token: string, id: string, postId: string, run: Run = bufferQuery): Promise<ItemWriteResult<ContentItemView>> {
  const data = await run<{ removePostFromContentItem: Failure & { contentItem?: RawItem } }>(token,
    `mutation RemovePostFromContentItem($input: RemovePostFromContentItemInput!) { removePostFromContentItem(input: $input) { __typename ... on RemovePostFromContentItemSuccess { contentItem { ${ITEM_FIELDS} } } ${ERRORS}} }`,
    { input: { id, postId } });
  const r = data.removePostFromContentItem;
  return r.__typename === "RemovePostFromContentItemSuccess" && r.contentItem ? { ok: true, value: view(r.contentItem) } : refused(r);
}
