/**
 * The per-person request limits the app's server actions share (src/lib/rate-limit.ts), and the answers they give when
 * one is reached. A plain module, not a "use server" file, so the action files can share it.
 */
import { signedInUserId } from "@/lib/current-user";
import { limit, type Action, type Limited } from "@/lib/rate-limit";

/** The signed-in person's limit for this action (src/lib/rate-limit.ts), or null while they are within it. */
export async function overLimit(action: Action): Promise<Limited | null> {
  const userId = await signedInUserId();
  if (!userId) return null;
  const l = await limit(action, userId);
  return l.ok ? null : l;
}
export const tooMany = (l: Limited) => ({ ok: false as const, message: `Too many requests just now. Try again in ${l.resetSeconds} seconds.` });
export const tooManyKind = (l: Limited) => ({ ok: false as const, kind: "limited" as const, retryAt: new Date(Date.now() + l.resetSeconds * 1000).toISOString() });
