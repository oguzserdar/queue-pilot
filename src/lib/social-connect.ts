import "server-only";
/**
 * Connecting and disconnecting a person's own Mastodon and Bluesky accounts.
 *
 * Mastodon: the person types their instance. Queue Pilot registers its own app there once per instance and callback
 * address (cached in qp_mastodon_app, secret encrypted), sends the person to the instance's authorize page with a
 * state value, and on the way back exchanges the code for a token, reads who the account is, and stores it encrypted.
 * The state, the instance and the person travel in a short-lived httpOnly cookie that is encrypted under SETTINGS_KEY,
 * so the instance the callback talks to comes from Queue Pilot's own cookie, never from the address bar.
 *
 * Bluesky: the person gives a handle and an app password. Queue Pilot signs in at their server (bsky.social unless they
 * name another), refuses a main account password, and stores the DID and the app password encrypted.
 *
 * Every address a person types goes through normalizeServer and then the guarded fetch (src/lib/safe-fetch.ts): https
 * only, never localhost, a private address or a redirect.
 *
 * Sources, Mastodon (docs.joinmastodon.org, read 15 Nov 2026):
 * - /methods/apps: POST /api/v1/apps with client_name, redirect_uris, scopes ("Space separated list of scopes. If none
 *   is provided, defaults to `read`"), website; answers client_id and client_secret. "Mastodon only supports
 *   provisioning confidential clients."
 * - /spec/oauth: the scope asked for at sign-in "must be a subset of the `scopes` registered with the app", and the
 *   redirect_uri "must be one of the `redirect_uris` registered with the app"; state and PKCE are recommended.
 * - /methods/oauth: GET /oauth/authorize (response_type=code, client_id, redirect_uri, scope, state); POST /oauth/token
 *   (grant_type=authorization_code, code, client_id, client_secret, redirect_uri) answers access_token and scope;
 *   POST /oauth/revoke (client_id, client_secret, token) answers {}. PKCE parameters were added in 4.3.0, so they are
 *   not sent: older instances are still in use, and the state plus the app secret carry the round trip.
 * - /methods/accounts: GET /api/v1/accounts/verify_credentials needs `profile` (4.3.0+) or `read:accounts`, so
 *   read:accounts is asked for alongside write:statuses (posting) and read:notifications (mentions).
 * - /api/oauth-scopes: granular scopes since 2.4.3.
 *
 * Sources, Bluesky (bluesky-social/atproto at 7dd086d4de20d22777a64043ee29f4afa9a5811b, read 15 Nov 2026):
 * - lexicons/com/atproto/server/createSession.json: output requires accessJwt, refreshJwt, handle, did; didDoc optional.
 * - packages/pds/src/account-manager/account-manager.ts (login): the identifier may be an email, a handle or a DID; a
 *   wrong password answers "Invalid identifier or password"; the account password is tried before app passwords.
 * - packages/pds/src/account-manager/helpers/auth.ts (formatScope) and src/auth-scope.ts: a session from the account
 *   password carries scope com.atproto.access, one from an app password com.atproto.appPass or
 *   com.atproto.appPassPrivileged. Other server software may use other strings, so only com.atproto.access is refused.
 * - packages/common-web/src/did-doc.ts (getPdsEndpoint): the account's server is the DID document's service with id
 *   #atproto_pds and type AtprotoPersonalDataServer.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import ipaddr from "ipaddr.js";
import * as z from "zod";
import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { directPostSend, mastodonApp as mastodonAppTable, socialAccount } from "@/db/schema";
import { BlueskyError, signIn } from "./bluesky";
import type { Get, Post } from "./mastodon";
import { BlockedAddressError, isPublicAddress, safeGet, safePost } from "./safe-fetch";
import { decryptSecret, encryptSecret } from "./secrets";

/** What Queue Pilot asks a Mastodon account for: who it is, its mentions, and posting. Nothing else. */
export const MASTODON_SCOPES = "read:accounts read:notifications write:statuses";

/** The cookie that carries a Mastodon sign-in between the start and the callback. */
export const MASTODON_COOKIE = "qp_mastodon";
/** How long a Mastodon sign-in may take, in seconds. */
export const MASTODON_COOKIE_MAX_AGE_S = 600;

/** The default Bluesky server: it signs in accounts hosted by Bluesky and names their own server in the DID document. */
export const DEFAULT_BLUESKY_SERVER = "https://bsky.social";

const TIMEOUT_MS = 20_000;

/** Connecting did not happen; the message is for the person, the code for the Settings notice. */
export class ConnectError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

/** The network calls, the key the credentials are encrypted with, and the clock. Tests pass fakes. */
export type ConnectDeps = { master: string; post?: Post; get?: Get; now?: () => Date };

const badAddress = () => new ConnectError("That address is not a public https server. Type the instance's address, like mastodon.social.", "bad-address");

/**
 * Reads a server address the person typed as an https origin. Accepts a bare host ("mastodon.social"), a full address,
 * or a handle with the instance in it ("@ada@mastodon.social").
 *
 * @returns The origin, e.g. https://mastodon.social
 * @throws ConnectError ("bad-address") for anything but https, sign-in details in the address, localhost, a name with
 *   no dot, or a private or reserved IP address
 */
export function normalizeServer(input: string): string {
  let text = input.trim();
  if (!text.includes("://")) text = `https://${text.slice(text.lastIndexOf("@") + 1)}`;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw badAddress();
  }
  if (url.protocol !== "https:" || url.username || url.password) throw badAddress();
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) throw badAddress();
  } else if (!host.includes(".") || /(^|\.)(localhost|local|internal|localdomain)$/.test(host)) {
    throw badAddress();
  }
  return url.origin;
}

/** The cached app for one instance and callback, with its secret decrypted, or null. */
async function cachedApp(origin: string, redirectUri: string, master: string): Promise<{ clientId: string; clientSecret: string; scopes: string } | null> {
  const [row] = await db().select().from(mastodonAppTable).where(and(eq(mastodonAppTable.origin, origin), eq(mastodonAppTable.redirectUri, redirectUri))).limit(1);
  return row ? { clientId: row.clientId, clientSecret: decryptSecret(row.clientSecret, master), scopes: row.scopes } : null;
}

/**
 * Queue Pilot's app on one Mastodon instance for this callback address: read from the cache, or registered once and
 * cached. When two connects race, both may register, and the first row written is the one everyone uses.
 *
 * @param origin - The instance's https origin (from normalizeServer)
 * @param redirectUri - This deployment's Mastodon callback address
 * @returns The app's client id and secret
 * @throws BlockedAddressError when the address is private or redirects; ConnectError when the instance refuses
 */
export async function mastodonApp(origin: string, redirectUri: string, deps: ConnectDeps): Promise<{ clientId: string; clientSecret: string }> {
  const cached = await cachedApp(origin, redirectUri, deps.master);
  if (cached && cached.scopes === MASTODON_SCOPES) return cached;
  const res = await (deps.post ?? safePost)(new URL("/api/v1/apps", origin), {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_name: "Queue Pilot", redirect_uris: redirectUri, scopes: MASTODON_SCOPES, website: new URL(redirectUri).origin }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    await res.body?.cancel();
    throw new ConnectError(`That instance did not let Queue Pilot sign in there (it answered ${res.status}). Check the address.`, "instance-refused");
  }
  const parsed = AppAnswer.safeParse(await res.json().catch(() => null));
  if (!parsed.success) throw new ConnectError("That address answered, but not like a Mastodon instance. Check the address.", "instance-refused");
  const body = parsed.data;
  await db()
    .insert(mastodonAppTable)
    .values({ origin, redirectUri, clientId: body.client_id, clientSecret: encryptSecret(body.client_secret, deps.master), scopes: MASTODON_SCOPES })
    // A row with the old scopes is replaced; a row a racing connect just wrote with these scopes is kept.
    .onConflictDoUpdate({ target: [mastodonAppTable.origin, mastodonAppTable.redirectUri], set: { clientId: body.client_id, clientSecret: encryptSecret(body.client_secret, deps.master), scopes: MASTODON_SCOPES, createdAt: new Date() }, setWhere: sql`${mastodonAppTable.scopes} <> ${MASTODON_SCOPES}` });
  const stored = await cachedApp(origin, redirectUri, deps.master);
  if (!stored) throw new Error("The Mastodon app was not saved");
  return stored;
}

/** What the cookie holds: who started, the state, the instance, the app and when it stops counting. */
/** The signed-in person, state, instance origin, client id and expiry (ms), sealed in the cookie between the two steps. */
const SealedShape = z.object({ u: z.string(), s: z.string(), o: z.string(), c: z.string(), e: z.number() });
type Sealed = z.infer<typeof SealedShape>;

// What each answer must hold, checked instead of trusted (docs.joinmastodon.org: apps, oauth/token,
// accounts/verify_credentials; atproto DID documents).
const AppAnswer = z.object({ client_id: z.string(), client_secret: z.string() });
const TokenAnswer = z.object({ access_token: z.string().optional().catch(undefined), scope: z.string().optional().catch(undefined), error: z.string().optional().catch(undefined) }).catch({});
const AccountAnswer = z.object({ id: z.string(), username: z.string() });
const ScopeClaim = z.object({ scope: z.string().nullable().catch(null).default(null) });
const DidDocument = z.object({ id: z.string(), service: z.array(z.unknown()) });
const PdsService = z.object({ id: z.string(), type: z.literal("AtprotoPersonalDataServer"), serviceEndpoint: z.string().startsWith("https://") });
const MastodonCredentials = z.object({ token: z.string().min(1), clientId: z.string().min(1) });

/**
 * Starts connecting a Mastodon account: registers or reuses the app on the instance and builds the authorize address.
 *
 * @param userId - The signed-in person
 * @param instance - What the person typed
 * @param redirectUri - This deployment's callback address
 * @returns Where to send the person, and the cookie value to set for the callback (encrypted)
 * @throws ConnectError for a bad address, an unreachable instance or one that refuses
 */
export async function startMastodonConnect(userId: string, instance: string, redirectUri: string, deps: ConnectDeps): Promise<{ url: string; cookie: string }> {
  const origin = normalizeServer(instance);
  let app: { clientId: string };
  try {
    app = await mastodonApp(origin, redirectUri, deps);
  } catch (e) {
    if (e instanceof ConnectError) throw e;
    if (e instanceof BlockedAddressError) throw badAddress();
    console.error(JSON.stringify({ event: "qp-mastodon-app-failed", origin, message: e instanceof Error ? e.message : String(e) }));
    throw new ConnectError("Queue Pilot could not reach that instance. Check the address, or try again in a minute.", "unreachable");
  }
  const state = randomBytes(24).toString("base64url");
  const now = (deps.now ?? (() => new Date()))();
  const sealed: Sealed = { u: userId, s: state, o: origin, c: app.clientId, e: now.getTime() + MASTODON_COOKIE_MAX_AGE_S * 1000 };
  const url = new URL("/oauth/authorize", origin);
  url.search = new URLSearchParams({ response_type: "code", client_id: app.clientId, redirect_uri: redirectUri, scope: MASTODON_SCOPES, state }).toString();
  return { url: url.toString(), cookie: encryptSecret(JSON.stringify(sealed), deps.master) };
}

const expired = () => new ConnectError("That Mastodon sign-in expired or did not match. Try Connect again.", "expired");

/** The cookie's contents when it decrypts and has every field, else null. */
function openCookie(cookie: string | undefined, master: string): Sealed | null {
  if (!cookie) return null;
  try {
    const v: unknown = JSON.parse(decryptSecret(cookie, master));
    const sealed = SealedShape.safeParse(v);
    return sealed.success ? sealed.data : null;
  } catch {
    return null;
  }
}

/** Constant-time equality for two strings of any length. */
function sameText(a: string, b: string): boolean {
  const x = createHash("sha256").update(a).digest();
  const y = createHash("sha256").update(b).digest();
  return timingSafeEqual(x, y);
}

/**
 * Finishes connecting a Mastodon account on the callback: checks the cookie against the person and the state,
 * exchanges the code, reads who the account is, and stores it. Reconnecting the same account updates its row and
 * clears "broken".
 *
 * @returns The account's handle, e.g. @ada@mastodon.social
 * @throws ConnectError ("expired") when the cookie is missing, changed, old, another person's, or the state differs;
 *   other codes when the instance refuses
 */
export async function finishMastodonConnect(input: { userId: string; cookie: string | undefined; state: string | null; code: string | null; redirectUri: string }, deps: ConnectDeps): Promise<{ handle: string }> {
  const now = (deps.now ?? (() => new Date()))();
  const sealed = openCookie(input.cookie, deps.master);
  if (!sealed || sealed.u !== input.userId || sealed.e <= now.getTime() || !input.state || !sameText(input.state, sealed.s) || !input.code) throw expired();
  const app = await cachedApp(sealed.o, input.redirectUri, deps.master);
  if (!app || app.clientId !== sealed.c) throw expired();
  const origin = sealed.o;
  const signIn = { origin, redirectUri: input.redirectUri, clientId: app.clientId };
  try {
    const { token, scope } = await exchangeCode(deps.post ?? safePost, signIn, app.clientSecret, input.code);
    const account = await whoIs(deps.get ?? safeGet, origin, token);
    const handle = `@${account.username}@${new URL(origin).hostname}`;
    await storeMastodonAccount(input.userId, { origin, accountId: account.id, handle, scope, credentials: encryptSecret(JSON.stringify({ token, clientId: app.clientId }), deps.master) });
    return { handle };
  } catch (e) {
    if (e instanceof ConnectError) throw e;
    if (e instanceof BlockedAddressError) throw badAddress();
    console.error(JSON.stringify({ event: "qp-mastodon-connect-failed", origin, message: e instanceof Error ? e.message : String(e) }));
    throw new ConnectError("Queue Pilot could not finish connecting just now. Try Connect again.", "failed");
  }
}

/** The instance and app a sign-in belongs to. */
type MastodonSignIn = { origin: string; redirectUri: string; clientId: string };

/**
 * Exchanges the sign-in code for a token. An instance that no longer knows the app answers invalid_client; the saved
 * app is dropped then, so the next Connect registers it again.
 */
async function exchangeCode(post: Post, s: MastodonSignIn, clientSecret: string, code: string): Promise<{ token: string; scope: string }> {
  const res = await post(new URL("/oauth/token", s.origin), {
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: s.clientId, client_secret: clientSecret, redirect_uri: s.redirectUri }).toString(),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const body = TokenAnswer.parse(await res.json().catch(() => null));
  if (res.ok && body.access_token !== undefined) return { token: body.access_token, scope: body.scope ?? MASTODON_SCOPES };
  if (body.error === "invalid_client") {
    await db().delete(mastodonAppTable).where(and(eq(mastodonAppTable.origin, s.origin), eq(mastodonAppTable.redirectUri, s.redirectUri), eq(mastodonAppTable.clientId, s.clientId)));
  }
  throw new ConnectError(`The instance did not finish the sign-in (${body.error?.slice(0, 100) ?? res.status}). Try Connect again.`, "failed");
}

/** Which account the token belongs to, as the instance says. */
async function whoIs(get: Get, origin: string, token: string): Promise<z.infer<typeof AccountAnswer>> {
  const me = await get(new URL("/api/v1/accounts/verify_credentials", origin), { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  const account = AccountAnswer.safeParse(await me.json().catch(() => null));
  if (!me.ok || !account.success) throw new ConnectError("The instance signed you in but would not say which account it is. Try Connect again.", "failed");
  return account.data;
}

/**
 * Saves the account, or updates it and clears "broken" on a reconnect. Mastodon ids are per instance, so a reconnect
 * only updates the row for the same instance.
 *
 * @throws ConnectError ("conflict") when the person has an account with this id on another instance
 */
async function storeMastodonAccount(userId: string, a: { origin: string; accountId: string; handle: string; scope: string; credentials: string }): Promise<void> {
  const [row] = await db()
    .insert(socialAccount)
    .values({ id: randomUUID(), userId, network: "mastodon", accountId: a.accountId, handle: a.handle, server: a.origin, credentials: a.credentials, scopes: a.scope })
    .onConflictDoUpdate({
      target: [socialAccount.userId, socialAccount.network, socialAccount.server, socialAccount.accountId],
      set: { handle: a.handle, credentials: a.credentials, scopes: a.scope, brokenAt: null },
      setWhere: sql`${socialAccount.server} = ${a.origin}`,
    })
    .returning({ id: socialAccount.id });
  if (!row) throw new ConnectError("You already connected an account with the same id on another instance. Disconnect it first.", "conflict");
}

const HANDLE = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** The access token's scope claim, read without verifying (only to refuse a main password), or null. */
function tokenScope(jwt: string): string | null {
  try {
    const claims: unknown = JSON.parse(Buffer.from(jwt.split(".")[1] ?? "", "base64url").toString("utf8"));
    return ScopeClaim.catch({ scope: null }).parse(claims).scope;
  } catch {
    return null;
  }
}

/** The DID document's own server (#atproto_pds), when it names a public https one. */
function pdsOf(did: string, doc: unknown): string | null {
  const d = DidDocument.safeParse(doc);
  if (!d.success || d.data.id !== did) return null;
  const service = d.data.service.map((s) => PdsService.safeParse(s)).find((s) => s.success && (s.data.id === "#atproto_pds" || s.data.id === `${did}#atproto_pds`));
  if (!service?.success) return null;
  try {
    return normalizeServer(service.data.serviceEndpoint);
  } catch {
    return null;
  }
}

/**
 * Connects a Bluesky account with an app password: signs in, refuses a main account password, and stores the DID,
 * the handle, the account's own server and the encrypted credentials. Reconnecting updates the row and clears "broken".
 *
 * @param input - The handle (with or without @), the app password, and the server when it is not bsky.social
 * @returns The handle Bluesky reported
 * @throws ConnectError with the server's reason when it refuses, or "main-password" for an account password
 */
export async function connectBluesky(userId: string, input: { handle: string; appPassword: string; server?: string }, deps: ConnectDeps): Promise<{ handle: string }> {
  const handle = input.handle.trim().replace(/^@/, "").toLowerCase();
  const appPassword = input.appPassword.trim();
  if (!HANDLE.test(handle) && !/^did:[a-z]+:[a-zA-Z0-9._:%-]+$/.test(handle)) throw new ConnectError("Type your Bluesky handle, like ada.bsky.social.", "bad-handle");
  if (!appPassword || appPassword.length > 200) throw new ConnectError("Paste an app password from Bluesky.", "bad-password");
  const server = normalizeServer(input.server?.trim() || DEFAULT_BLUESKY_SERVER);
  const now = deps.now ?? (() => new Date());
  let session: Awaited<ReturnType<typeof signIn>>;
  try {
    session = await signIn(server, handle, appPassword, deps.post ?? safePost, now);
  } catch (e) {
    if (e instanceof BlueskyError && e.status === 429) throw new ConnectError("Bluesky asked to wait before signing in again. Try again in a few minutes.", "slow");
    if (e instanceof BlueskyError) throw new ConnectError(`Bluesky did not accept that handle and app password (${e.reason ?? e.status}). Check both, or make a new app password in Bluesky under Settings, Privacy and security, App passwords.`, "refused");
    if (e instanceof BlockedAddressError) throw badAddress();
    console.error(JSON.stringify({ event: "qp-bluesky-connect-failed", server, message: e instanceof Error ? e.message : String(e) }));
    throw new ConnectError("Queue Pilot could not reach that Bluesky server. Check the address, or try again in a minute.", "unreachable");
  }
  if (tokenScope(session.accessJwt) === "com.atproto.access") {
    throw new ConnectError("That is your account password. Queue Pilot only takes an app password: make one in Bluesky under Settings, Privacy and security, App passwords.", "main-password");
  }
  const shown = session.handle ?? handle;
  const pds = pdsOf(session.did, session.didDoc) ?? server;
  // The DID, not the handle, signs in later: a handle can change, the DID does not.
  const credentials = encryptSecret(JSON.stringify({ identifier: session.did, appPassword }), deps.master);
  // A DID is the same account whichever server hosts it: an account that moved updates its row instead of adding one.
  const moved = await db().update(socialAccount).set({ handle: shown, server: pds, credentials, brokenAt: null, session: null })
    .where(and(eq(socialAccount.userId, userId), eq(socialAccount.network, "bluesky"), eq(socialAccount.accountId, session.did))).returning({ id: socialAccount.id });
  if (!moved.length) {
    await db()
      .insert(socialAccount)
      .values({ id: randomUUID(), userId, network: "bluesky", accountId: session.did, handle: shown, server: pds, credentials })
      .onConflictDoUpdate({ target: [socialAccount.userId, socialAccount.network, socialAccount.server, socialAccount.accountId], set: { handle: shown, credentials, brokenAt: null, session: null } });
  }
  return { handle: shown };
}

/**
 * Disconnects one of this person's accounts: posts still waiting to go to it are cancelled and the row is deleted (its
 * reply read position goes with it). For Mastodon the token is then revoked on the instance, best effort: the account
 * is gone from Queue Pilot either way.
 *
 * @returns False when the account is not this person's; nothing is touched or revoked then
 */
export async function disconnectSocialAccount(userId: string, accountId: string, deps: ConnectDeps): Promise<boolean> {
  const [row] = await db().select().from(socialAccount).where(and(eq(socialAccount.id, accountId), eq(socialAccount.userId, userId))).limit(1);
  if (!row) return false;
  const now = (deps.now ?? (() => new Date()))();
  await db().transaction(async (tx) => {
    // A claimed post whose call has not started is cancelled too, the same way disconnecting Telegram does it.
    await tx
      .update(directPostSend)
      .set({ status: "cancelled", revision: sql`${directPostSend.revision} + 1`, updatedAt: now })
      .where(and(eq(directPostSend.userId, userId), eq(directPostSend.kind, row.network), eq(directPostSend.target, row.id), or(eq(directPostSend.status, "scheduled"), and(eq(directPostSend.status, "pending"), isNull(directPostSend.callStartedAt)))));
    await tx.delete(socialAccount).where(and(eq(socialAccount.id, row.id), eq(socialAccount.userId, userId)));
  });
  if (row.network === "mastodon") await revokeMastodon(row.server, row.credentials, deps);
  return true;
}

/** Revokes a Mastodon token with the app that issued it. Never throws: a failure is logged and the disconnect stands. */
async function revokeMastodon(origin: string, storedCredentials: string, deps: ConnectDeps): Promise<void> {
  try {
    const stored = MastodonCredentials.safeParse(JSON.parse(decryptSecret(storedCredentials, deps.master)));
    if (!stored.success) return;
    const { token, clientId } = stored.data;
    const [app] = await db().select().from(mastodonAppTable).where(and(eq(mastodonAppTable.origin, origin), eq(mastodonAppTable.clientId, clientId))).limit(1);
    if (!app) return;
    const res = await (deps.post ?? safePost)(new URL("/oauth/revoke", origin), {
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, client_secret: decryptSecret(app.clientSecret, deps.master), token }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    await res.body?.cancel();
  } catch (e) {
    console.warn(JSON.stringify({ event: "qp-mastodon-revoke-failed", origin, message: e instanceof Error ? e.message : String(e) }));
  }
}
