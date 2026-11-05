/**
 * @fileoverview The organization's Buffer tags: read them, create one, and set the tags on a draft (Buffer's tags
 * guide, read 4 Nov 2026). Buffer calls the whole tag API an early preview. Tags belong to the organization and are
 * shared by everyone in it; plans allow 3 (Free) or 250 (paid). Reading needs posts:read, writing posts:write.
 */
import { bufferQuery } from "./client";

/** One tag as Queue Pilot shows it. */
export type BufferTag = { id: string; name: string; color: string; isLocked: boolean };

/** Buffer's own limit on a tag name. */
export const MAX_TAG_NAME = 100;
/** The color Queue Pilot gives a new tag when none is chosen: a six-digit hex triplet, as Buffer requires. */
export const DEFAULT_TAG_COLOR = "#8F2457";

type Run = typeof bufferQuery;

/**
 * Every tag in one organization, sorted by name as Buffer returns them.
 *
 * @param token - The person's Buffer access token
 * @param organizationId - The Buffer organization
 * @returns All its tags (the plan caps them at 250)
 */
export async function listTags(token: string, organizationId: string, run: Run = bufferQuery): Promise<BufferTag[]> {
  const tags: BufferTag[] = [];
  let after: string | null = null;
  // At most 3 pages of 100: a paid plan holds 250 tags.
  for (let page = 0; page < 3; page++) {
    const data: { tagsV2: { edges: { node: BufferTag }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await run(token,
      "query Tags($input: TagsInput!, $first: Int, $after: String) { tagsV2(input: $input, first: $first, after: $after) { edges { node { id name color isLocked } } pageInfo { hasNextPage endCursor } } }",
      { input: { organizationId }, first: 100, after });
    tags.push(...data.tagsV2.edges.map((e) => e.node));
    if (!data.tagsV2.pageInfo.hasNextPage || !data.tagsV2.pageInfo.endCursor) break;
    after = data.tagsV2.pageInfo.endCursor;
  }
  return tags;
}

/** A tag write's outcome, with Buffer's reason when it refused. */
export type TagWriteResult<T> = { ok: true; value: T } | { ok: false; kind: "duplicate" | "limit" | "invalid" | "other"; message: string };

const refusal = (typename: string, message?: string): TagWriteResult<never> => ({
  ok: false,
  kind: typename === "DuplicateError" ? "duplicate" : typename === "LimitReachedError" ? "limit" : typename === "InvalidInputError" ? "invalid" : "other",
  message: message ?? "Buffer did not save the tag.",
});

/**
 * Creates a tag in the organization. Names are compared exactly, so a different capitalisation is a new tag.
 *
 * @param token - The person's Buffer access token
 * @param organizationId - The Buffer organization
 * @param name - 1 to MAX_TAG_NAME characters
 * @param color - A six-digit hex triplet such as #8F2457
 * @returns The tag as Buffer saved it, or Buffer's refusal (duplicate name, plan limit, invalid input)
 */
export async function createTag(token: string, organizationId: string, name: string, color = DEFAULT_TAG_COLOR, run: Run = bufferQuery): Promise<TagWriteResult<BufferTag>> {
  const data = await run<{ createTag: { __typename: string; tag?: BufferTag; message?: string } }>(token,
    "mutation CreateTag($input: CreateTagInput!) { createTag(input: $input) { __typename ... on TagActionSuccess { tag { id name color isLocked } } ... on MutationError { message } } }",
    { input: { organizationId, tag: { name, color } } });
  const r = data.createTag;
  return r.__typename === "TagActionSuccess" && r.tag ? { ok: true, value: r.tag } : refusal(r.__typename, r.message);
}

/**
 * Sets exactly these tags on one draft, keeping it a draft with its text and time unchanged.
 *
 * Reads the post from Buffer first: Buffer treats an edit without text as an empty post and refuses it, so the
 * draft's current text goes with the tags; and a post that stopped being a draft is refused without an edit,
 * because the same edit would pull a scheduled post back to drafts.
 *
 * @param token - The person's Buffer access token
 * @param postId - The draft
 * @param tagIds - The complete list of tags it should carry; empty removes them all
 * @returns Whether Buffer accepted the edit, or why it was not made
 */
export async function setDraftTags(token: string, postId: string, tagIds: string[], run: Run = bufferQuery): Promise<{ ok: true } | { ok: false; message: string }> {
  const { post } = await run<{ post: { id: string; text: string | null; status: string } | null }>(token,
    "query DraftForTags($input: PostInput!) { post(input: $input) { id text status } }", { input: { id: postId } });
  if (!post) return { ok: false, message: "This post is no longer in Buffer." };
  if (post.status !== "draft") return { ok: false, message: "Only drafts can be tagged here; this post is approved, scheduled or sent." };
  const data = await run<{ editPost: { __typename: string; message?: string } }>(token,
    "mutation SetTags($input: EditPostInput!) { editPost(input: $input) { __typename ... on MutationError { message } } }",
    { input: { id: postId, text: post.text ?? "", tagIds, saveToDraft: true } });
  return data.editPost.__typename === "PostActionSuccess" ? { ok: true } : { ok: false, message: data.editPost.message ?? "Buffer did not change the tags." };
}

/**
 * Renames or recolors a tag. Buffer replaces both name and color, so the current value of the unchanged one goes with
 * it. Buffer refuses a locked tag, a duplicate name, and a caller who is not an organization administrator.
 *
 * Why: lets an assistant keep the organization's tags tidy for the person (for example, merging spelling variants by
 * renaming), as a second interface on Buffer's tag API.
 *
 * @param token - The person's Buffer access token
 * @param id - The tag
 * @param name - The new (or unchanged) name, 1 to MAX_TAG_NAME characters
 * @param color - The new (or unchanged) six-digit hex color
 * @returns The tag as it now stands, or Buffer's refusal
 */
export async function updateTag(token: string, id: string, name: string, color: string, run: Run = bufferQuery): Promise<TagWriteResult<BufferTag>> {
  const data = await run<{ updateTag: { __typename: string; tag?: BufferTag; message?: string } }>(token,
    "mutation UpdateTag($input: UpdateTagInput!) { updateTag(input: $input) { __typename ... on TagActionSuccess { tag { id name color isLocked } } ... on MutationError { message } } }",
    { input: { id, tag: { name, color } } });
  const r = data.updateTag;
  return r.__typename === "TagActionSuccess" && r.tag ? { ok: true, value: r.tag } : refusal(r.__typename, r.message);
}

/**
 * Deletes a tag. Buffer removes it from every post, idea and content item carrying it, which are otherwise untouched.
 * Only an organization administrator may delete.
 *
 * @param token - The person's Buffer access token
 * @param id - The tag
 * @returns The deleted id, or Buffer's refusal
 */
export async function deleteTag(token: string, id: string, run: Run = bufferQuery): Promise<TagWriteResult<string>> {
  const data = await run<{ deleteTag: { __typename: string; id?: string; message?: string } }>(token,
    "mutation DeleteTag($input: DeleteTagInput!) { deleteTag(input: $input) { __typename ... on DeleteTagActionSuccess { id } ... on MutationError { message } } }",
    { input: { id } });
  const r = data.deleteTag;
  return r.__typename === "DeleteTagActionSuccess" && r.id ? { ok: true, value: r.id } : refusal(r.__typename, r.message);
}
