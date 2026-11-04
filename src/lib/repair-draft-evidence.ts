import { bufferQuery } from "./buffer/client";
import type { Post } from "./buffer/queries";
import { ownDraft, type EditResult } from "./edit-drafts";
import type { EvidenceInput } from "./source-evidence";
import { replaceDraftEvidence } from "./source-store";

/** Evidence repair never edits Buffer, creates a draft or spends an AI action. */
export async function repairDraftEvidence(
  userId: string, token: string, input: { postId: string; text: string; expectedText: string; snapshotId: string; evidence: EvidenceInput[] },
  posts: Post[], wrote: ReadonlySet<string>, q: typeof bufferQuery = bufferQuery,
): Promise<EditResult> {
  const p = ownDraft(input.postId, posts, wrote);
  if (typeof p === "string") return { ok: false, reason: p };
  if (input.text !== input.expectedText) return { ok: false, reason: "Repair evidence without changing the text. Supply the current draft text as both text and expectedText; edit wording separately." };
  const { post } = await q<{ post: Post | null }>(token, "query ($input: PostInput!) { post(input: $input) { id channelId text status } }", { input: { id: p.id } });
  if (!post || post.id !== p.id || post.channelId !== p.channelId || post.status !== "draft" || post.text !== input.expectedText) {
    return { ok: false, reason: "This draft changed or is no longer a draft. Read it again before repairing evidence. Nothing was changed." };
  }
  await replaceDraftEvidence(userId, p.id, post.text, input.snapshotId, input.evidence);
  return { ok: true };
}
