"use server";

/**
 * Posts from Sources: the places a person can send to, sending one post with its exact text per
 * place, resending a place Telegram or Discord refused, and the recent results. The Discord channel is checked on the
 * server against the bot's real permissions every time, never taken from the browser on trust.
 */
import { revalidatePath } from "next/cache";
import { signedInUserId } from "@/lib/current-user";
import { postgresEchoStore } from "@/lib/echo-store";
import { botTokens } from "@/lib/echo-run";
import { limit } from "@/lib/rate-limit";
import { recordAction } from "@/lib/security-events";
import * as telegram from "@/lib/telegram";
import * as discord from "@/lib/discord";
import { PLACE_NAME, followUpIdFor, resendFailed, scheduleDirectPost, sendDirectPost, sendTimeProblem, sentLate, shownStatus, type PostItem, type PostKind, type DirectPostStatus } from "@/lib/direct-posts";
import { postgresDirectPostStore } from "@/lib/direct-post-store";
import { postgresSnapshotStore } from "@/lib/buffer/snapshot-store";
import { directPostDeps, startTimerOrNote } from "@/lib/direct-post-run";

/** Where the person can post, as the composer shows it. */
export type PostTargets = {
  telegram: { label: string; limit: number } | null;
  discord: { label: string; limit: number; channels: { id: string; name: string; canPost: boolean }[]; defaultId: string | null } | null;
  /** Why Discord channels could not be listed, when the bot is connected but the read failed. */
  problem?: string;
};

/**
 * One place of a recent direct post, as Sources shows it. sendAt is set for a scheduled one; late when it went out
 * more than five minutes after it. followsBuffer marks a follow-up, which is changed on its Buffer draft, not here.
 */
export type DirectPostView = { postId: string; kind: PostKind; label: string; text: string; status: DirectPostStatus; link: string | null; error: string | null; at: string; sendAt: string | null; late: boolean; followsBuffer: boolean };

/** What a change to a post answers: done (with a note to show), or the reason it was not. */
export type ActionResult = { ok: true; note?: string } | { ok: false; message: string };

/** Why a message cannot go to that place as written, or null. */
function textProblem(kind: PostKind, text: string): string | null {
  const max = kind === "telegram" ? telegram.TEXT_LIMIT : discord.CONTENT_LIMIT;
  if (!text) return `Write the ${PLACE_NAME[kind]} message, or leave ${PLACE_NAME[kind]} out.`;
  if (text.length > max) return `The ${PLACE_NAME[kind]} message is ${text.length} characters; ${PLACE_NAME[kind]} takes up to ${max}.`;
  return null;
}

// Each panel or composer that opens lists the server's channels with the bot every person shares. Keep a list for a
// minute (the promise, so opens at the same moment share one call; a failed call is not kept).
const channelLists = new Map<string, { at: number; list: Promise<Awaited<ReturnType<typeof discord.channelsWithAccess>>> }>();
function guildChannels(token: string, guildId: string) {
  const hit = channelLists.get(guildId);
  if (hit && Date.now() - hit.at < 60_000) return hit.list;
  for (const [id, e] of channelLists) if (Date.now() - e.at >= 60_000) channelLists.delete(id);
  const list = discord.channelsWithAccess(token, guildId);
  channelLists.set(guildId, { at: Date.now(), list });
  list.catch(() => { if (channelLists.get(guildId)?.list === list) channelLists.delete(guildId); });
  return list;
}

/** Where the signed-in person can post right now: their Telegram channel, and their Discord server's channels. */
export async function postTargets(): Promise<PostTargets> {
  const userId = await signedInUserId();
  if (!userId) return { telegram: null, discord: null };
  const [dests, tokens] = await Promise.all([postgresEchoStore().destinations(userId), botTokens()]);
  const tg = dests.find((d) => d.kind === "telegram");
  const dc = dests.find((d) => d.kind === "discord");
  const out: PostTargets = {
    telegram: tg && tokens.telegram ? { label: tg.label, limit: telegram.TEXT_LIMIT } : null,
    discord: null,
  };
  if (dc && dc.guildId && tokens.discord) {
    try {
      const channels = await guildChannels(tokens.discord, dc.guildId);
      out.discord = { label: dc.label.split(" #")[0] ?? dc.label, limit: discord.CONTENT_LIMIT, channels, defaultId: channels.find((c) => c.id === dc.target && c.canPost)?.id ?? channels.find((c) => c.canPost)?.id ?? null };
    } catch (e) {
      out.problem = `Discord did not list the channels just now: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return out;
}

/** One post from the form. With sendAt (ISO), it is scheduled for that time instead of sent now. */
export type SendPostInput = { key: string; sendAt?: string; telegram?: { text: string }; discord?: { channelId: string; text: string } };
export type SendPostResult =
  | { ok: true; results: { kind: PostKind; label: string; status: DirectPostStatus; link: string | null; error: string | null }[]; note?: string }
  | { ok: false; message: string };

/** True when the post is a follow-up of a Buffer post, which is changed on its draft, not in Sources. */
async function followsBuffer(userId: string, postId: string): Promise<boolean> {
  return (await postgresDirectPostStore().rows(userId, postId)).some((r) => r.bufferPostId);
}

/**
 * Checks the places a person chose and turns them into what gets sent: their connected Telegram channel, and a
 * Discord channel in their server that the bot can post in (checked against Discord every time).
 */
async function placeItems(userId: string, input: { telegram?: { text: string } | null; discord?: { channelId: string; text: string } | null }, tokens: { telegram?: string; discord?: string }): Promise<{ ok: true; items: PostItem[] } | { ok: false; message: string }> {
  const dests = await postgresEchoStore().destinations(userId);
  const items: PostItem[] = [];
  const tg = dests.find((d) => d.kind === "telegram");
  const dc = dests.find((d) => d.kind === "discord");
  if (input.telegram) {
    const text = String(input.telegram.text ?? "").trim();
    if (!tg || !tokens.telegram) return { ok: false, message: "Connect a Telegram channel first." };
    const problem = textProblem("telegram", text);
    if (problem) return { ok: false, message: problem };
    items.push({ kind: "telegram", target: tg.target, label: tg.label, text });
  }
  if (input.discord) {
    const text = String(input.discord.text ?? "").trim();
    if (!dc || !dc.guildId || !tokens.discord) return { ok: false, message: "Add Queue Pilot to a Discord server first." };
    const problem = textProblem("discord", text);
    if (problem) return { ok: false, message: problem };
    let channels;
    try { channels = await guildChannels(tokens.discord, dc.guildId); } catch (e) { return { ok: false, message: `Discord did not answer just now: ${e instanceof Error ? e.message : String(e)}` }; }
    const channel = channels.find((c) => c.id === String(input.discord!.channelId));
    if (!channel) return { ok: false, message: "That channel is not in your Discord server." };
    if (!channel.canPost) return { ok: false, message: `Queue Pilot cannot post in #${channel.name}. Give its role View Channel and Send Messages there, or pick another channel.` };
    items.push({ kind: "discord", target: channel.id, label: `${dc.label.split(" #")[0]} #${channel.name}`, text, guildId: dc.guildId });
  }
  return { ok: true, items };
}

/** Sends one post now, or schedules it, each place getting the exact text the person confirmed. */
export async function sendPostAction(input: SendPostInput): Promise<SendPostResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (!input || typeof input !== "object" || typeof input.key !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(input.key)) return { ok: false, message: "Open the post again and send it from there." };
  const sendAt = input.sendAt === undefined ? null : new Date(String(input.sendAt));
  if (sendAt) {
    const problem = sendTimeProblem(sendAt, new Date());
    if (problem) return { ok: false, message: problem };
  }
  if (!(await limit("outbound", userId)).ok) return { ok: false, message: "Too many sends this hour. Try again later." };
  const tokens = await botTokens();
  const built = await placeItems(userId, input, tokens);
  if (!built.ok) return built;
  const { items } = built;
  if (!items.length) return { ok: false, message: "Choose at least one place to send it." };

  const deps = directPostDeps(() => Promise.resolve(tokens));
  if (sendAt) {
    // The post is saved first; a timer that does not start only makes it late, never lost or doubled.
    const scheduled = await scheduleDirectPost(userId, input.key, items, sendAt, deps);
    const note = await startTimerOrNote(scheduled.postId, scheduled.revision, sendAt);
    revalidatePath("/sources");
    return { ok: true, results: scheduled.results, note };
  }
  const { results } = await sendDirectPost(userId, input.key, items, deps);
  if (results.some((r) => r.status === "sent" || r.status === "uncertain")) {
    await recordAction(userId, "direct_post_sent", { via: "app" }, { name: results.filter((r) => r.status !== "failed").map((r) => (r.kind === "telegram" ? "Telegram" : "Discord")).join(" and ") });
  }
  revalidatePath("/sources");
  return { ok: true, results };
}

/** Sends a place again after Telegram or Discord refused it, with the same text. */
export async function resendPostAction(postId: string, kind: PostKind): Promise<SendPostResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof postId !== "string" || postId.length > 100 || (kind !== "telegram" && kind !== "discord")) return { ok: false, message: "Unknown post." };
  if (!(await limit("outbound", userId)).ok) return { ok: false, message: "Too many sends this hour. Try again later." };
  const tokens = await botTokens();
  if (!tokens[kind]) return { ok: false, message: "That bot is not set up on this deployment." };
  const r = await resendFailed(userId, postId, kind, directPostDeps(() => Promise.resolve(tokens)));
  if (!r) return { ok: false, message: "Only a message Telegram or Discord refused can be sent again. A follow-up is changed on its Buffer draft." };
  revalidatePath("/sources");
  return { ok: true, results: [r] };
}

/** What can change on a scheduled post: its time (ISO) and the text for each place. */
export type ChangeScheduledInput = { sendAt?: string; telegram?: string; discord?: string };

/**
 * Changes a scheduled post's time or text before it goes out. The timer set for the old version sends nothing. A
 * follow-up of a Buffer post is changed on its draft instead, since its time is the Buffer post's.
 */
export async function changeScheduledPostAction(postId: string, change: ChangeScheduledInput): Promise<ActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof postId !== "string" || postId.length > 100 || !change || typeof change !== "object") return { ok: false, message: "Unknown post." };
  const sendAt = change.sendAt === undefined ? undefined : new Date(String(change.sendAt));
  if (sendAt) {
    const problem = sendTimeProblem(sendAt, new Date());
    if (problem) return { ok: false, message: problem };
  }
  const texts: Partial<Record<PostKind, string>> = {};
  for (const kind of ["telegram", "discord"] as const) {
    if (change[kind] === undefined) continue;
    const text = String(change[kind]).trim();
    const problem = textProblem(kind, text);
    if (problem) return { ok: false, message: problem };
    texts[kind] = text;
  }
  if (!(await limit("outbound", userId)).ok) return { ok: false, message: "Too many changes this hour. Try again later." };
  if (await followsBuffer(userId, postId)) return { ok: false, message: "This one follows a Buffer post. Change it on that draft in Next week." };
  const rows = await postgresDirectPostStore().reschedule(userId, postId, { sendAt, texts }, new Date());
  if (!rows.length) return { ok: false, message: "It already went out or was cancelled, so it cannot be changed." };
  revalidatePath("/sources");
  return { ok: true, note: await startTimerOrNote(postId, Math.max(...rows.map((r) => r.revision)), rows[0].sendAt!) };
}

/** Cancels a scheduled post before it goes out. */
export async function cancelScheduledPostAction(postId: string): Promise<ActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof postId !== "string" || postId.length > 100) return { ok: false, message: "Unknown post." };
  if (await followsBuffer(userId, postId)) return { ok: false, message: "This one follows a Buffer post. Turn it off on that draft in Next week." };
  const n = await postgresDirectPostStore().cancel(userId, postId, new Date());
  revalidatePath("/sources");
  return n ? { ok: true } : { ok: false, message: "It already went out or was cancelled." };
}

/** The person's recent post results, newest first. */
export async function recentDirectPosts(): Promise<DirectPostView[]> {
  const userId = await signedInUserId();
  if (!userId) return [];
  const now = new Date();
  return (await postgresDirectPostStore().recent(userId, 12)).map((r) => ({
    postId: r.postId, kind: r.kind, label: r.label, text: r.text, status: shownStatus(r, now), link: r.link, error: r.error, at: r.createdAt.toISOString(),
    sendAt: r.sendAt?.toISOString() ?? null, late: sentLate(r), followsBuffer: !!r.bufferPostId,
  }));
}

/** One place of a draft's follow-up, as the draft dialog shows it. */
export type FollowUpPlace = { kind: PostKind; label: string; text: string; target: string; status: DirectPostStatus; error: string | null; link: string | null };

/** A Buffer post's follow-up places, and the Buffer post's time when Queue Pilot has it. */
export async function followUpFor(bufferPostId: string): Promise<{ places: FollowUpPlace[]; dueAt: string | null }> {
  const userId = await signedInUserId();
  if (!userId || typeof bufferPostId !== "string" || bufferPostId.length > 100) return { places: [], dueAt: null };
  const [rows, snap] = await Promise.all([
    postgresDirectPostStore().rows(userId, await followUpIdFor(userId, bufferPostId)),
    postgresSnapshotStore().get(userId),
  ]);
  return { dueAt: snap?.data.posts.find((p) => p.id === bufferPostId)?.dueAt ?? null, places: placesOf(rows) };
}

/** A follow-up's places as the panel shows them: cancelled ones are left out. */
function placesOf(rows: { kind: PostKind; label: string; text: string; target: string; status: DirectPostStatus; error: string | null; link: string | null; updatedAt: Date; callStartedAt: Date | null; claimedUntil: Date | null }[]): FollowUpPlace[] {
  const now = new Date();
  return rows.filter((r) => r.status !== "cancelled").map((r) => ({ kind: r.kind, label: r.label, text: r.text, target: r.target, status: shownStatus(r, now), error: r.error, link: r.link }));
}

/**
 * What to send where when a Buffer post goes out, per place: the text (and Discord channel) to send, null to turn the
 * place off, or left out to keep it as it is (a place the panel could not load is never changed).
 */
export type FollowUpInput = { telegram?: { text: string } | null; discord?: { channelId: string; text: string } | null };

/**
 * Sets which places follow one of the person's Buffer posts, with their text. Each goes out once Buffer has
 * published the post; a place turned off stops waiting. A place already going out, sent or failed is not changed,
 * and the answer says so.
 */
export async function saveFollowUpAction(bufferPostId: string, input: FollowUpInput): Promise<{ ok: false; message: string } | { ok: true; note?: string; places: FollowUpPlace[] }> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof bufferPostId !== "string" || bufferPostId.length > 100 || !input || typeof input !== "object") return { ok: false, message: "Unknown post." };
  const [snap, allowed, tokens] = await Promise.all([postgresSnapshotStore().get(userId), limit("outbound", userId), botTokens()]);
  // The post must be one of this person's, from their own saved Buffer week, with a time.
  const post = snap?.data.posts.find((p) => p.id === bufferPostId);
  if (!post || !post.dueAt || post.status === "sent") return { ok: false, message: "Only a post that has not gone out yet, and has a time, can be followed." };
  if (!allowed.ok) return { ok: false, message: "Too many changes this hour. Try again later." };
  const built = await placeItems(userId, { telegram: input.telegram || null, discord: input.discord || null }, tokens);
  if (!built.ok) return built;
  const store = postgresDirectPostStore();
  const id = await followUpIdFor(userId, bufferPostId);
  const at = new Date(Date.parse(post.dueAt) + 60_000);
  const now = new Date();
  const unchanged: PostKind[] = [];
  for (const kind of ["telegram", "discord"] as const) {
    if (input[kind] === undefined) continue;
    const item = built.items.find((i) => i.kind === kind);
    if (item) { if (!(await store.follow(userId, id, item, at, now, bufferPostId))) unchanged.push(kind); }
    else await store.unfollow(userId, id, kind, now);
  }
  const rows = await store.rows(userId, id);
  // Turning off a place that is going out right now cannot stop it.
  for (const kind of ["telegram", "discord"] as const) {
    if (input[kind] === null && rows.some((r) => r.kind === kind && r.status === "pending")) unchanged.push(kind);
  }
  const waiting = rows.filter((r) => r.status === "scheduled");
  const notes = [unchanged.length ? `${unchanged.map((k) => PLACE_NAME[k]).join(" and ")} already went out or is going out now, so it was not changed.` : undefined];
  if (waiting.length) notes.push(await startTimerOrNote(id, Math.max(...waiting.map((r) => r.revision)), at));
  revalidatePath("/week");
  return { ok: true, note: notes.filter(Boolean).join(" ") || undefined, places: placesOf(rows) };
}
