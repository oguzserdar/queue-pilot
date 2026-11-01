/**
 * The one approval path for the app's buttons, Needs you and approve_drafts. It reads each draft from Buffer right
 * now, refuses any whose playbook check is out of date or that breaks a blocking rule, and schedules the rest.
 */
import { approveDrafts, type ApproveResult } from "./approve-drafts";
import { bufferQuery } from "./buffer/client";
import { readPostsNow, type Post } from "./buffer/queries";
import { approvable } from "./draft-readiness";
import { postgresRulesStore } from "./rules-store";
import { postgresWrittenStore } from "./written-store";

type Query = typeof bufferQuery;

/** `posts` are the drafts as Buffer has them at this moment, for the caller to compare or record. */
export async function approveChecked(userId: string, token: string, ids: string[], now: Date, q: Query = bufferQuery, fresh?: Post[]): Promise<ApproveResult & { posts: Post[] }> {
  const posts = fresh ?? await readPostsNow(token, ids, q);
  const [written, rules] = await Promise.all([postgresWrittenStore().get(userId, ids), postgresRulesStore().list(userId).catch(() => null)]);
  if (rules === null) return { approved: [], refused: ids.map((id) => ({ id, reason: "Your playbook could not be read just now, so nothing was scheduled. Try again." })), posts };
  const gate = approvable(ids, written, posts, rules);
  const res = gate.allowed.length ? await approveDrafts(token, gate.allowed, posts, now, new Set(written.map((w) => w.postId)), q) : { approved: [], refused: [] };
  return { approved: res.approved, refused: [...gate.refused, ...res.refused], posts };
}
