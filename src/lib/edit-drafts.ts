/**
 * Lets the user's AI change or remove a draft it saved: Buffer's editPost (new text, kept as a draft) and deletePost
 * (developers.buffer.com reference, EditPostInput and DeletePostInput). Only a post that is a draft in the caller's own,
 * freshly read Buffer data is touched; a scheduled, sent or unknown post is refused, so a crafted id cannot change a
 * post that is about to go out or belongs to someone else. Only drafts Queue Pilot recorded writing (written-store)
 * can be touched: Buffer marks every API-made post via "api", other apps' included, so that field is not enough. New
 * text gets the same length check as save_drafts.
 */
import { bufferQuery } from "./buffer/client";
import type { Channel, Post } from "./buffer/queries";
import { tooLong } from "./char-limits";

type Query = typeof bufferQuery;
export type EditResult = { ok: true } | { ok: false; reason: string };

const EDIT_POST = `mutation ($input: EditPostInput!) {
  editPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id status } }
    ... on MutationError { message }
  }
}`;

const DELETE_POST = `mutation ($input: DeletePostInput!) {
  deletePost(input: $input) {
    __typename
    ... on MutationError { message }
  }
}`;

/**
 * The draft with this id among the caller's own posts, or the reason it cannot be changed. `wrote` holds the post ids
 * Queue Pilot recorded writing for this person.
 */
function ownDraft(id: string, posts: Post[], wrote: ReadonlySet<string>): Post | string {
  const p = posts.find((x) => x.id === id);
  if (!p) return "That post is not in the user's Buffer queue. Call show_next_week for current drafts.";
  if (p.status !== "draft") return "That post is no longer a draft (it was approved or sent), so it can only be changed in Buffer.";
  if (!wrote.has(id)) return "Queue Pilot did not write that draft, so only the person can change or delete it in Buffer.";
  return p;
}

/**
 * Replaces a draft's text and keeps it a draft at its slot. `gate` is the playbook check (save-for-user.ts judgeEdit):
 * it returns a refusal reason, or null when the new text may be saved.
 */
export async function updateDraft(
  token: string, id: string, text: string, posts: Post[], channels: Channel[], wrote: ReadonlySet<string>, q: Query = bufferQuery,
  gate: (text: string, network: string) => Promise<string | null> = async () => null,
): Promise<EditResult> {
  const p = ownDraft(id, posts, wrote);
  if (typeof p === "string") return { ok: false, reason: p };
  const service = channels.find((c) => c.id === p.channelId)?.service ?? "";
  const long = tooLong(service, text);
  if (long) return { ok: false, reason: long };
  const refusal = await gate(text, service);
  if (refusal) return { ok: false, reason: refusal };
  const res = await q<{ editPost: { __typename: string; message?: string } }>(token, EDIT_POST, { input: { id, text, saveToDraft: true } });
  return res.editPost.__typename === "PostActionSuccess" ? { ok: true } : { ok: false, reason: res.editPost.message ?? "Buffer refused the change." };
}

/** Deletes a draft Queue Pilot wrote. Never a scheduled or sent post. */
export async function deleteDraft(token: string, id: string, posts: Post[], wrote: ReadonlySet<string>, q: Query = bufferQuery): Promise<EditResult> {
  const p = ownDraft(id, posts, wrote);
  if (typeof p === "string") return { ok: false, reason: p };
  const res = await q<{ deletePost: { __typename: string; message?: string } }>(token, DELETE_POST, { input: { id } });
  // DeletePostPayload is DeletePostSuccess | VoidMutationError (which implements MutationError); only success counts.
  return res.deletePost.__typename === "DeletePostSuccess" ? { ok: true } : { ok: false, reason: res.deletePost.message ?? "Buffer refused to delete it." };
}
