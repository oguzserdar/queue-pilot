"use server";
/**
 * Settings actions for the person's Mastodon and Bluesky accounts: connect Bluesky with an app password, disconnect an
 * account, and turn automatic replies on or off. Each acts only for the signed-in person; an account id that is not
 * theirs is answered as not found. Connecting Mastodon goes through /api/mastodon/start, since it leaves the page.
 */
import { revalidatePath } from "next/cache";
import { signedInUserId } from "@/lib/current-user";
import { limit } from "@/lib/rate-limit";
import { setReplies } from "@/lib/social-accounts";
import { parsePostingTimes, setPostingTimes } from "@/lib/posting-times";
import { ConnectError, connectBluesky, disconnectSocialAccount } from "@/lib/social-connect";

type Result = { ok: boolean; message: string };
const signedOut: Result = { ok: false, message: "Sign in first." };
const notFound: Result = { ok: false, message: "That account is no longer connected. Reload the page." };

/** Connects a Bluesky account with its handle and an app password (never the account password). */
export async function connectBlueskyAction(input: { handle: string; appPassword: string; server?: string }): Promise<Result> {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  const master = process.env.SETTINGS_KEY;
  if (!master) return { ok: false, message: "This Queue Pilot is not set up to keep account sign-ins (SETTINGS_KEY is missing)." };
  if (!(await limit("connect", userId)).ok) return { ok: false, message: "Too many tries just now. Wait a minute and try again." };
  try {
    const { handle } = await connectBluesky(userId, input, { master });
    revalidatePath("/settings");
    return { ok: true, message: `Connected ${handle}.` };
  } catch (e) {
    if (e instanceof ConnectError) return { ok: false, message: e.message };
    console.error(JSON.stringify({ event: "qp-bluesky-connect-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not connect that account. Try again in a minute." };
  }
}

/** Disconnects one of the person's accounts; on Mastodon the token is also revoked, best effort. */
export async function disconnectSocialAction(accountId: string): Promise<Result> {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  const master = process.env.SETTINGS_KEY;
  if (!master) return { ok: false, message: "This Queue Pilot is not set up to keep account sign-ins (SETTINGS_KEY is missing)." };
  if (!(await disconnectSocialAccount(userId, accountId, { master }))) return notFound;
  revalidatePath("/settings");
  return { ok: true, message: "Disconnected." };
}

/** Turns automatic replies on or off for one of the person's accounts. */
export async function setRepliesAction(accountId: string, on: boolean): Promise<Result> {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  const r = await setReplies(userId, accountId, on);
  if (r === "not-found") return notFound;
  if (r === "taken") return { ok: false, message: "Someone else in Queue Pilot already answers this account's mentions. Only one person can have replies on for an account, so nothing is answered twice." };
  revalidatePath("/settings");
  return { ok: true, message: on ? "Replies are on, from now." : "Replies are off." };
}

/** Saves when Queue Pilot may post to one of the person's accounts: times per weekday, in a time zone. */
export async function setPostingTimesAction(accountId: string, days: { day: string; times: string[] }[], timeZone: string): Promise<Result> {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  const parsed = parsePostingTimes(days, timeZone);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if ((await setPostingTimes(userId, accountId, parsed)) === "not-found") return notFound;
  revalidatePath("/settings");
  revalidatePath("/week");
  const n = parsed.schedule.reduce((t, d) => t + d.times.length, 0);
  return { ok: true, message: n ? `Saved ${n} posting time${n === 1 ? "" : "s"} a week.` : "No posting times: nothing is planned for this account." };
}
