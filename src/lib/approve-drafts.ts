/**
 * Approving a draft schedules it at its own slot time: Buffer's editPost with saveToDraft false, keeping dueAt and text
 * (developers.buffer.com reference, EditPostInput). Only drafts recorded as written by Queue Pilot for this person are
 * approved; anything else is refused, so a crafted id cannot schedule someone else's post or a post that already went.
 * Buffer checks its posting limits when a post leaves draft and its own reason is passed back unchanged.
 */
import { BufferApiError, bufferQuery } from "./buffer/client";
import { notSentReason, waitRefusal } from "./buffer/not-sent";
import type { Post } from "./buffer/queries";
import { imageLinkCheck } from "./image-check";
import type { Check } from "./preflight";

type Query = typeof bufferQuery;

/**
 * `uncertain` lists drafts whose scheduling may have reached Buffer without an answer. `waitUntil` is set when Buffer's
 * request limit stopped the batch before the rest were sent (null when the time is unknown); those are in `refused`.
 */
export type ApproveResult = { approved: string[]; refused: { id: string; reason: string }[]; uncertain?: string[]; waitUntil?: Date | null };

/** At most this many drafts per press, so one request stays well inside a server time limit and Buffer's budget. */
export const MAX_APPROVE = 25;

const EDIT_POST = `mutation ($input: EditPostInput!) {
  editPost(input: $input) {
    __typename
    ... on PostActionSuccess { post { id status } }
    ... on MutationError { message }
  }
}`;

/** Why a draft cannot be scheduled before Buffer is asked, or null when it may be. Checked in this order. */
async function refusalBeforeScheduling(id: string, p: Post | undefined, wrote: ReadonlySet<string>, now: Date, checkImage: (url: string) => Promise<Check>): Promise<string | null> {
  if (!p) return "This post is no longer in your Buffer queue.";
  if (p.status !== "draft") return "This post is not a draft any more.";
  if (!wrote.has(id)) return "Queue Pilot did not write this draft. Schedule it in Buffer.";
  if (!p.dueAt || Date.parse(p.dueAt) <= now.getTime()) return "Its time has passed; pick a new time in Buffer.";
  // A broken image link fails at publish time, so it is caught here instead (at most four images per post).
  const images = (p.assets ?? []).filter((a) => a.type === "image").slice(0, 4);
  const failed = (await Promise.all(images.map((a) => checkImage(a.source)))).find((c) => c.result === "fail");
  return failed ? failed.detail : null;
}

/** Schedules drafts on approval. `posts` and `wrote` must both come from the signed-in person. */
export async function approveDrafts(
  token: string,
  ids: string[],
  posts: Post[],
  now: Date,
  wrote: ReadonlySet<string>,
  q: Query = bufferQuery,
  checkImage: (url: string) => Promise<Check> = (url) => imageLinkCheck(url),
): Promise<ApproveResult> {
  const byId = new Map(posts.map((p) => [p.id, p]));
  const approved: string[] = [];
  const uncertain: string[] = [];
  const refused: ApproveResult["refused"] = [];

  const unique = [...new Set(ids)];
  for (const id of unique.slice(MAX_APPROVE)) refused.push({ id, reason: `Up to ${MAX_APPROVE} drafts at a time; approve the rest next.` });
  const batch = unique.slice(0, MAX_APPROVE);
  for (let i = 0; i < batch.length; i++) {
    const id = batch[i];
    const p = byId.get(id);
    const refusal = await refusalBeforeScheduling(id, p, wrote, now, checkImage);
    if (refusal !== null || !p) { refused.push({ id, reason: refusal ?? "This post is no longer in your Buffer queue." }); continue; }
    try {
      const res = await q<{ editPost: { __typename: string; message?: string } }>(token, EDIT_POST, {
        // The text as just read from Buffer: without it Buffer treats the post as empty and refuses it.
        input: { id, text: p.text, saveToDraft: false, mode: "customScheduled", dueAt: p.dueAt },
      });
      if (res.editPost.__typename === "PostActionSuccess") approved.push(id);
      else refused.push({ id, reason: res.editPost.message ?? "Buffer refused to schedule this draft." });
    } catch (e) {
      const wait = waitRefusal(e);
      if (wait) {
        // Nothing was sent for this draft or the ones after it, and every further call would be refused too: stop,
        // keep what was scheduled, and say which are still drafts and when to try again.
        for (const rest of batch.slice(i)) refused.push({ id: rest, reason: notSentReason(wait).replace("writing this draft", "scheduling this draft") });
        return { approved, refused, ...(uncertain.length ? { uncertain } : {}), waitUntil: wait.retryAt };
      }
      if (e instanceof BufferApiError && e.status >= 400 && e.status < 500) {
        // An HTTP refusal: nothing was scheduled. A 200 with errors can carry an internal error after the write, so it
        // stays uncertain below.
        refused.push({ id, reason: e.message || "Buffer refused to schedule this draft." });
        continue;
      }
      // A network failure or server error does not prove Buffer rejected the mutation. Do not make its confirmation reusable.
      uncertain.push(id);
      refused.push({ id, reason: "Scheduling could not be confirmed. Check this post in Buffer before trying again." });
    }
  }
  return { approved, refused, ...(uncertain.length ? { uncertain } : {}) };
}
