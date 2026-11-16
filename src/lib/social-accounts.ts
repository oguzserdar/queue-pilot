import "server-only";
import { isSocialNetwork, type SocialNetwork } from "./social-networks";
/**
 * The social accounts a person connected with their own credentials (Mastodon, Bluesky). Credentials are stored
 * encrypted under SETTINGS_KEY (src/lib/secrets.ts) and decrypted only here, on the server, for one send.
 */
import { and, eq, isNull } from "drizzle-orm";
import * as z from "zod";
import { db } from "@/db";
import { replyCursor, socialAccount } from "@/db/schema";
import { decryptSecret } from "./secrets";

/** One connected account, ready to post with. Never sent to the browser or to an AI app. */
export type SocialAccount = {
  id: string;
  network: SocialNetwork;
  handle: string;
  server: string;
  /** Mastodon: { token }. Bluesky: { identifier, appPassword }. */
  credentials: Record<string, string>;
  broken: boolean;
  /** The network's own id for the account (Mastodon account id, Bluesky DID): what its limits are counted by. */
  networkAccountId: string;
};

/**
 * Reads one of this person's connected accounts, with its credentials decrypted.
 *
 * @param userId - The account's owner; an account of anyone else is never returned
 * @param accountId - The account's row id (the send row's target)
 * @returns The account, or null when it is not this person's, was disconnected, or is not a direct-posting network
 * @throws Error when SETTINGS_KEY is missing or the stored credentials cannot be decrypted
 */
export async function readSocialAccount(userId: string, accountId: string): Promise<SocialAccount | null> {
  const [row] = await db().select().from(socialAccount).where(and(eq(socialAccount.id, accountId), eq(socialAccount.userId, userId))).limit(1);
  return row ? decrypted(row) : null;
}

type Row = typeof socialAccount.$inferSelect;

// Every writer (social-connect.ts) stores a flat object of strings; anything else is a damaged row and throws.
const Credentials = z.record(z.string(), z.string());

/** A stored row as a usable account, or null for a network Queue Pilot does not post to directly. */
function decrypted(row: Row): SocialAccount | null {
  if (!isSocialNetwork(row.network)) return null;
  const master = process.env.SETTINGS_KEY;
  if (!master) throw new Error("SETTINGS_KEY is not set, so connected accounts cannot be read");
  return {
    id: row.id, network: row.network, handle: row.handle, server: row.server,
    credentials: Credentials.parse(JSON.parse(decryptSecret(row.credentials, master))),
    broken: row.brokenAt !== null,
    networkAccountId: row.accountId,
  };
}

/** A connected account whose owner turned replies on, with whose it is and the network's own id for it. */
export type ReplyAccount = SocialAccount & { userId: string; networkAccountId: string };

/**
 * Every account, across workspaces, whose replies are on and which is not broken. An account whose credentials cannot
 * be decrypted is logged and left out, so one bad row never stops the others.
 */
export async function replyAccounts(): Promise<ReplyAccount[]> {
  const rows = await db().select().from(socialAccount).where(and(eq(socialAccount.repliesOn, true), isNull(socialAccount.brokenAt))).orderBy(socialAccount.id);
  return rows.flatMap((row) => {
    try {
      const a = decrypted(row);
      return a ? [{ ...a, userId: row.userId, networkAccountId: row.accountId }] : [];
    } catch (e) {
      console.error(JSON.stringify({ event: "qp-reply-account-unreadable", userId: row.userId, accountId: row.id, message: e instanceof Error ? e.message : String(e) }));
      return [];
    }
  });
}

/**
 * This person's connected accounts on one network, without credentials: who they are on it, so the reply run never
 * answers the account itself or another account of the same owner.
 */
export async function ownAccounts(userId: string, network: SocialNetwork): Promise<{ networkAccountId: string; handle: string; server: string }[]> {
  return db()
    .select({ networkAccountId: socialAccount.accountId, handle: socialAccount.handle, server: socialAccount.server })
    .from(socialAccount)
    .where(and(eq(socialAccount.userId, userId), eq(socialAccount.network, network)));
}

/**
 * The key that makes one replier per network account: a Bluesky DID is global; a Mastodon id is unique only on its
 * server, so the server goes in, lowercased and without a trailing slash so two spellings of one server match.
 */
export function repliesOwnerKey(a: { network: string; server: string; accountId: string }): string {
  return a.network === "mastodon" ? `mastodon ${a.server.trim().toLowerCase().replace(/\/+$/, "")} ${a.accountId}` : `${a.network} ${a.accountId}`;
}

/**
 * Turns replies on or off for one of this person's accounts. Either way the read position is forgotten, so turning
 * them on starts with a read that only notes where the mentions are and answers none of them, and the time is recorded
 * so nothing posted before it is answered. Only one person may have replies on for a given network account (a partial
 * unique index backs the check), so a mention can never be answered twice.
 *
 * @returns "ok"; "not-found" when the account is not this person's; "taken" when someone else already answers it
 */
export async function setReplies(userId: string, accountId: string, on: boolean, now: Date = new Date()): Promise<"ok" | "not-found" | "taken"> {
  try {
    return await db().transaction(async (tx) => {
      const [row] = await tx.select({ repliesOn: socialAccount.repliesOn, network: socialAccount.network, server: socialAccount.server, accountId: socialAccount.accountId }).from(socialAccount).where(and(eq(socialAccount.id, accountId), eq(socialAccount.userId, userId))).for("update");
      if (!row) return "not-found";
      // Already in that state: nothing changes, so the start time and the read position are kept and no mention is skipped.
      if (row.repliesOn === on) return "ok";
      await tx.update(socialAccount).set({ repliesOn: on, repliesSince: on ? now : null, repliesOwner: on ? repliesOwnerKey(row) : null }).where(and(eq(socialAccount.id, accountId), eq(socialAccount.userId, userId)));
      await tx.delete(replyCursor).where(and(eq(replyCursor.accountId, accountId), eq(replyCursor.userId, userId)));
      return "ok";
    });
  } catch (e) {
    if (on && isUniqueViolation(e)) return "taken";
    throw e;
  }
}

/** True when Postgres refused a write because of a unique index (SQLSTATE 23505), however deep the driver wrapped it. */
function isUniqueViolation(e: unknown): boolean {
  for (let x: unknown = e, i = 0; x && i < 5; x = fieldOf(x, "cause"), i++) {
    if (fieldOf(x, "code") === "23505") return true;
  }
  return false;
}

/** One field of a thrown value, or undefined when it is not an object or lacks the field. */
function fieldOf(x: unknown, key: "cause" | "code"): unknown {
  return typeof x === "object" && x !== null && key in x ? Reflect.get(x, key) : undefined;
}

/**
 * Marks an account whose sign-in the network refused, so the person is asked to connect it again. Its reply read
 * position is forgotten, so reconnecting never answers the mentions that came in while it was broken.
 */
export async function markAccountBroken(userId: string, accountId: string, now: Date = new Date()): Promise<void> {
  await db().update(socialAccount).set({ brokenAt: now }).where(and(eq(socialAccount.id, accountId), eq(socialAccount.userId, userId)));
  await db().delete(replyCursor).where(and(eq(replyCursor.accountId, accountId), eq(replyCursor.userId, userId)));
}

/** A connected account as the person sees it in Settings or through their AI app: never its credentials. */
export type SocialAccountView = {
  id: string;
  network: SocialNetwork;
  handle: string;
  server: string;
  repliesOn: boolean;
  /** The network refused its sign-in; the person is asked to connect it again. */
  broken: boolean;
  connectedAt: string;
  /** When Queue Pilot may post to it, per weekday; empty until set. */
  postingSchedule: { day: string; times: string[] }[];
  /** The time zone the posting times are in; null until set. */
  timeZone: string | null;
};

/**
 * This person's connected accounts, oldest first. The credentials column is never read, so nothing is decrypted.
 *
 * @param userId - Whose accounts; nobody else's are ever returned
 */
export async function listSocialAccounts(userId: string): Promise<SocialAccountView[]> {
  const rows = await db()
    .select({ id: socialAccount.id, network: socialAccount.network, handle: socialAccount.handle, server: socialAccount.server, repliesOn: socialAccount.repliesOn, brokenAt: socialAccount.brokenAt, postingSchedule: socialAccount.postingSchedule, timeZone: socialAccount.timeZone, connectedAt: socialAccount.connectedAt })
    .from(socialAccount)
    .where(eq(socialAccount.userId, userId))
    .orderBy(socialAccount.connectedAt, socialAccount.id);
  return rows.flatMap((r) => (isSocialNetwork(r.network) ? [{ id: r.id, network: r.network, handle: r.handle, server: r.server, repliesOn: r.repliesOn, broken: r.brokenAt !== null, connectedAt: r.connectedAt.toISOString(), postingSchedule: r.postingSchedule.map((d) => ({ day: d.day, times: d.times })), timeZone: r.timeZone }] : []));
}
