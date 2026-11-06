/**
 * The one approval path for the app's buttons, Needs you and approve_drafts. It reads each draft from Buffer right
 * now, refuses any whose playbook check is out of date or that breaks a blocking rule, and schedules the rest.
 */
import { approveDrafts, type ApproveResult } from "./approve-drafts";
import { bufferQuery } from "./buffer/client";
import { readPostsNow, type Post, type Channel } from "./buffer/queries";
import { sourceHoldsForPosts } from "./source-store";
import { approvable } from "./draft-readiness";
import { postgresRulesStore } from "./rules-store";
import { postgresWrittenStore } from "./written-store";

type Query = typeof bufferQuery;

/** `posts` are the drafts as Buffer has them at this moment, for the caller to compare or record. */
export async function approveChecked(userId: string, token: string, ids: string[], now: Date, q: Query = bufferQuery, fresh?: Post[], channels?: Pick<Channel, "id" | "service">[]): Promise<ApproveResult & { posts: Post[] }> {
  const posts = fresh ?? await readPostsNow(token, ids, q);
  const [written, rules] = await Promise.all([postgresWrittenStore().get(userId, ids), postgresRulesStore().list(userId).catch(() => null)]);
  if (rules === null) return { approved: [], refused: ids.map((id) => ({ id, reason: "Your playbook could not be read just now, so nothing was scheduled. Try again." })), posts };
  const networks = new Map(channels?.map(c => [c.id, c.service]));
  const unknown = new Set(channels ? posts.filter(p => !networks.has(p.channelId)).map(p => p.id) : []);
  const gate = approvable(ids.filter(id => !unknown.has(id)), written, posts.map(p => ({ ...p, network: networks.get(p.channelId) })), rules);
  const sourceBlocks = await sourceHoldsForPosts(userId, posts);
  for (const id of gate.allowed.filter(id => sourceBlocks.has(id))) gate.refused.push({ id, reason: sourceBlocks.get(id)! });
  gate.allowed = gate.allowed.filter(id => !sourceBlocks.has(id));
  const res: ApproveResult = gate.allowed.length ? await approveDrafts(token, gate.allowed, posts, now, new Set(written.map((w) => w.postId)), q) : { approved: [], refused: [] };
  return { ...res, refused: [...[...unknown].map(id => ({ id, reason: "This account is not in the current connection. Refresh Buffer before approving." })), ...gate.refused, ...res.refused], posts };
}

/**
 * Records who approved the drafts that were scheduled, for the draft window's "why this post exists". A failed write
 * is logged and never undoes the scheduling.
 *
 * @param by - APPROVED_IN_APP for the person in the app, else the AI app's name
 */
export async function recordApprover(userId: string, approved: string[], by: string): Promise<void> {
  if (!approved.length) return;
  try { await postgresWrittenStore().markApproved(userId, approved, by); }
  catch (e) { console.error(JSON.stringify({ event: "qp-approver-save-failed", message: e instanceof Error ? e.message : String(e) })); }
}
