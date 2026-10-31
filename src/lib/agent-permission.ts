/**
 * What a connected AI app (ChatGPT, Claude) may do for the person. Today one choice: whether it may approve drafts,
 * which schedules real posts. "ask" is the default: the app gets a signed confirm token only after showing the exact
 * drafts, and the token is good for exactly those drafts for ten minutes.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { db } from "../db";
import { agentPermission } from "../db/schema";

export const APPROVE_MODES = ["ask", "direct", "off"] as const;
export type ApproveMode = (typeof APPROVE_MODES)[number];

const isMode = (v: unknown): v is ApproveMode => APPROVE_MODES.includes(v as ApproveMode);

/** The person's choice, or "ask" when they never set one. */
export async function approveMode(userId: string): Promise<ApproveMode> {
  const [row] = await db().select({ approve: agentPermission.approve }).from(agentPermission).where(eq(agentPermission.userId, userId));
  return isMode(row?.approve) ? row.approve : "ask";
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
const sorted = (ids: string[]) => [...new Set(ids)].sort();

/** A token naming exactly these drafts for this person, valid for ten minutes. */
export function signApproval(userId: string, ids: string[], now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ userId, ids: sorted(ids), expires: now + TEN_MINUTES })).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(`approve:${body}`).digest("base64url")}`;
}

/** True only for an unexpired token this person was given for exactly these drafts. */
export function verifyApproval(userId: string, ids: string[], token: string, now = Date.now()): boolean {
  try {
    const [body, mac, extra] = token.split(".");
    if (!body || !mac || extra !== undefined || token.length > 10_000) return false;
    const expected = createHmac("sha256", secret()).update(`approve:${body}`).digest();
    const actual = Buffer.from(mac, "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    const v = JSON.parse(Buffer.from(body, "base64url").toString());
    return v.userId === userId && Number.isFinite(v.expires) && v.expires > now && JSON.stringify(v.ids) === JSON.stringify(sorted(ids));
  } catch { return false; }
}
