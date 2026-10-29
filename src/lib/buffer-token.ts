/**
 * A valid Buffer access token for one user, from Better Auth's account table.
 *
 * Buffer refresh tokens are single-use: refreshing twice with the same one revokes the user's sign-in.
 * Better Auth 1.7.14 refreshes inside getAccessToken whenever under 5 seconds remain (api/routes/account.mjs,
 * getValidAccessToken) and does not stop two requests from doing it at once. So every caller goes through here:
 * one call per user at a time in this process (shared promise), and across server instances a Postgres
 * transaction-level advisory lock, after which the waiting caller reads the token the first one refreshed.
 */
import { BUFFER_PROVIDER_ID, type getAuth } from "./auth";
import { dbLockPool } from "./db";

type Auth = NonNullable<Awaited<ReturnType<typeof getAuth>>>;
/** Runs `fn` while holding a lock named `key`. */
export type WithLock = <T>(key: string, fn: () => Promise<T>) => Promise<T>;

/**
 * Transaction-level advisory lock on a lock-only connection, released by commit or rollback even when `fn` throws.
 * Neon's pooled URL runs PgBouncer in transaction mode, where session-level advisory locks are not supported
 * (neon.com/docs/connect/connection-pooling); a transaction-level lock stays on one server connection until it ends.
 */
export const pgAdvisoryLock: WithLock = async (key, fn) => {
  const client = await dbLockPool().connect();
  try {
    await client.query("begin");
    try {
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [key]);
      const result = await fn();
      await client.query("commit");
      return result;
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  } finally {
    client.release();
  }
};

const inFlight = new Map<string, Promise<string>>();

export function bufferAccessToken(auth: Auth, userId: string, withLock: WithLock = pgAdvisoryLock): Promise<string> {
  const running = inFlight.get(userId);
  if (running) return running;

  const promise = withLock(`buffer-token:${userId}`, async () => {
    const accounts = await (await auth.$context).internalAdapter.findAccounts(userId);
    const buffer = accounts.find((a) => a.providerId === BUFFER_PROVIDER_ID);
    if (!buffer) throw new Error("This Queue Pilot account has no Buffer connection");
    const { accessToken } = await auth.api.getAccessToken({ body: { accountId: buffer.id, userId } });
    if (!accessToken) throw new Error("Buffer sign-in expired; sign in to Queue Pilot again");
    return accessToken;
  });

  inFlight.set(userId, promise);
  promise.finally(() => { if (inFlight.get(userId) === promise) inFlight.delete(userId); }).catch(() => {});
  return promise;
}
