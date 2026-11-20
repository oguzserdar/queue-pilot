import "server-only";
/**
 * One Bluesky session per connected account, kept encrypted with the account and reused across posts and mention
 * reads. A server counts sign-ins (the PDS allows 30 per 5 minutes and 300 a day per account:
 * packages/pds/src/api/com/atproto/server/createSession.ts at 7dd086d4), so signing in for every call would run out.
 *
 * Order: the saved session; when Bluesky answers 400 ExpiredToken (auth-verifier.ts: a jose JWTExpired, so nothing was
 * written) the session is refreshed and the call made once more; when the refresh token is refused too, sign in again.
 * Any other failure goes back to the caller untouched, never retried here.
 */
import { and, eq } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db";
import { socialAccount } from "@/db/schema";
import { BlueskyError, createSession, isExpiredToken, refreshSession, type BlueskySession, type Post } from "./bluesky";
import { decryptSecret, encryptSecret } from "./secrets";
import type { SocialAccount } from "./social-accounts";

const masterKey = () => {
  const m = process.env.SETTINGS_KEY;
  if (!m) throw new Error("SETTINGS_KEY is not set, so Bluesky sessions cannot be kept");
  return m;
};

// The stored session, checked instead of trusted; a copy that does not hold one is treated as no session.
const SavedSession = z.object({ did: z.string(), accessJwt: z.string(), refreshJwt: z.string().optional() });

async function saved(userId: string, accountId: string): Promise<BlueskySession | null> {
  const [row] = await db().select({ session: socialAccount.session }).from(socialAccount).where(and(eq(socialAccount.id, accountId), eq(socialAccount.userId, userId))).limit(1);
  if (!row?.session) return null;
  try {
    const session = SavedSession.safeParse(JSON.parse(decryptSecret(row.session, masterKey())));
    return session.success ? session.data : null;
  } catch {
    return null;
  }
}

async function save(userId: string, accountId: string, s: BlueskySession): Promise<void> {
  await db().update(socialAccount).set({ session: encryptSecret(JSON.stringify(s), masterKey()) }).where(and(eq(socialAccount.id, accountId), eq(socialAccount.userId, userId)));
}

async function signInAndSave(userId: string, account: SocialAccount, post?: Post): Promise<BlueskySession> {
  const s = await createSession(account.server, account.credentials.identifier ?? "", account.credentials.appPassword ?? "", post);
  await save(userId, account.id, s);
  return s;
}

/**
 * The account's session: the saved one, or a new sign-in that is then saved.
 *
 * @throws BlueskyError when Bluesky refuses the sign-in; any other error when it does not answer
 */
export async function blueskySession(userId: string, account: SocialAccount, deps: { post?: Post } = {}): Promise<BlueskySession> {
  return (await saved(userId, account.id)) ?? signInAndSave(userId, account, deps.post);
}

/**
 * Runs one Bluesky call with the account's session, renewing it once if the access token expired.
 *
 * @param fn - The call; it receives the session to use
 * @returns What fn returns
 * @throws What fn throws, except an expired token, which is renewed and retried once
 */
export async function withBlueskySession<T>(userId: string, account: SocialAccount, fn: (s: BlueskySession) => Promise<T>, deps: { post?: Post } = {}): Promise<T> {
  const session = await blueskySession(userId, account, deps);
  try {
    return await fn(session);
  } catch (e) {
    if (!isExpiredToken(e)) throw e;
    return fn(await renew(userId, account, session, deps.post));
  }
}

/** A fresh session: refreshed with the refresh token, or a new sign-in when that is refused or missing. */
async function renew(userId: string, account: SocialAccount, old: BlueskySession, post?: Post): Promise<BlueskySession> {
  if (old.refreshJwt) {
    try {
      const s = await refreshSession(account.server, old.refreshJwt, post);
      await save(userId, account.id, s);
      return s;
    } catch (e) {
      // A refused refresh token (expired, revoked) means sign in again; a wait or no answer goes back to the caller.
      if (!(e instanceof BlueskyError) || e.status === 429) throw e;
    }
  }
  return signInAndSave(userId, account, post);
}
