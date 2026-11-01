/**
 * What a connected AI app (ChatGPT, Claude) may do for the person. Today one choice: whether it may approve drafts,
 * which schedules real posts. "ask" is the default: the app gets a signed confirm token only after showing the exact
 * drafts. The token names each draft's text, account, time and images as shown, and the setting it was given under. It
 * is good for ten minutes and can schedule only once.
 */
import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { agentPermission, approvalClaim } from "../db/schema";
import type { Post } from "./buffer/queries";

export const APPROVE_MODES = ["ask", "direct", "off"] as const;
export type ApproveMode = (typeof APPROVE_MODES)[number];

const isMode = (v: unknown): v is ApproveMode => APPROVE_MODES.includes(v as ApproveMode);

/** The person's choice, and a revision that changes every time they save it, so older tokens stop working. */
export async function approvePermission(userId: string): Promise<{ mode: ApproveMode; revision: string }> {
  const [row] = await db().select({ approve: agentPermission.approve, updatedAt: agentPermission.updatedAt }).from(agentPermission).where(eq(agentPermission.userId, userId));
  return { mode: isMode(row?.approve) ? row.approve : "ask", revision: row ? String(row.updatedAt.getTime()) : "default" };
}

/** The person's choice, or "ask" when they never set one. */
export async function approveMode(userId: string): Promise<ApproveMode> {
  return (await approvePermission(userId)).mode;
}

/** Saves the person's choice. Only the app's own settings screen calls this; no connector tool can. */
export async function setApproveMode(userId: string, mode: ApproveMode): Promise<boolean> {
  if (!isMode(mode)) return false;
  await db().insert(agentPermission).values({ userId, approve: mode })
    .onConflictDoUpdate({ target: agentPermission.userId, set: { approve: mode, updatedAt: sql`now()` } });
  return true;
}

const TEN_MINUTES = 600_000;
function secret() {
  const key = process.env.SESSION_SECRET;
  if (!key) throw new Error("Approving from a connected app is unavailable just now.");
  return key;
}

/** What the person was shown for one draft: its account, text, time and images. Any change means asking again. */
export function postFingerprint(p: Pick<Post, "id" | "channelId" | "text" | "dueAt" | "assets">): string {
  const assets = (p.assets ?? []).map((a) => [a.type, a.source]);
  return createHash("sha256").update(JSON.stringify([p.id, p.channelId, p.text, p.dueAt ?? null, assets])).digest("base64url");
}

type Shown = Pick<Post, "id" | "channelId" | "text" | "dueAt" | "assets">;
const canonical = (posts: Shown[]) => [...new Map(posts.map((p) => [p.id, postFingerprint(p)]))].sort(([a], [b]) => a.localeCompare(b));

/** A token naming exactly these drafts as shown, for this person under this setting, valid for ten minutes. */
export function signApproval(userId: string, posts: Shown[], revision: string, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ userId, posts: canonical(posts), revision, nonce: randomUUID(), expires: now + TEN_MINUTES })).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(`approve:${body}`).digest("base64url")}`;
}

/**
 * The token's nonce and expiry when it was given to this person, under this setting, for exactly these drafts as they
 * are now, and has not expired; otherwise null.
 */
export function verifyApproval(userId: string, posts: Shown[], token: string, revision: string, now = Date.now()): { nonce: string; expires: number } | null {
  try {
    const [body, mac, extra] = token.split(".");
    if (!body || !mac || extra !== undefined || token.length > 10_000) return null;
    const expected = createHmac("sha256", secret()).update(`approve:${body}`).digest();
    const actual = Buffer.from(mac, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const v = JSON.parse(Buffer.from(body, "base64url").toString());
    const ok = v.userId === userId && v.revision === revision && typeof v.nonce === "string" && Number.isFinite(v.expires) && v.expires > now
      && JSON.stringify(v.posts) === JSON.stringify(canonical(posts));
    return ok ? { nonce: v.nonce, expires: v.expires } : null;
  } catch { return null; }
}

/** Claims a token for one use. False when it was already used, including by a request running at the same moment. */
export async function claimApproval(userId: string, nonce: string, expires: number): Promise<boolean> {
  const rows = await db().insert(approvalClaim).values({ nonce, userId, expiresAt: new Date(expires) }).onConflictDoNothing().returning({ nonce: approvalClaim.nonce });
  return rows.length === 1;
}

/** Gives a claimed token back when nothing was scheduled with it, so the same yes can be tried again. */
export async function releaseApproval(userId: string, nonce: string): Promise<void> {
  await db().delete(approvalClaim).where(and(eq(approvalClaim.userId, userId), eq(approvalClaim.nonce, nonce)));
}
