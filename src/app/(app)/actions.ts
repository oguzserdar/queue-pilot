"use server";

import { placeholdersIn } from "@/lib/placeholders";
import { overLimit, tooMany, tooManyKind } from "./action-limits";

import { revalidatePath } from "next/cache";
import { NoBufferAccount } from "@/lib/buffer-token";
import { waitMessage, waitRefusal } from "@/lib/buffer/not-sent";
import { nextSteps, type NextStep } from "@/lib/next-step";
import { bufferForWriting, forceRefreshCurrentUser, freshBufferForCurrentUser, signedInUserId } from "@/lib/current-user";
import { writeSlotsForUser, type WriteWeekActionResult } from "@/lib/write-slots-for-user";
import { openSlots, parseSlotId } from "@/lib/open-slots";
import { checkNote, judgeEdit, saveDraftsForUser } from "@/lib/save-for-user";
import { deleteDraft, updateDraft, moveToDraft } from "@/lib/edit-drafts";
import { draftSlot, recordAction } from "@/lib/security-events";
import { postgresWrittenStore, wroteIds } from "@/lib/written-store";
import { readPostsNow, type Post } from "@/lib/buffer/queries";
import { FeedError, findFeed } from "@/lib/feeds"
import { approvedApps } from "@/lib/ai-access";
import { dismissOffer, isOfferKey } from "@/lib/offer-store";
import { postgresVoiceStore } from "@/lib/voice-store";
import { postgresSnapshotStore } from "@/lib/buffer/snapshot-store";
import { TelegramError, connectCodeFor, drainConnectCodes } from "@/lib/telegram";
import { postgresEchoStore, postgresTelegramCodes } from "@/lib/echo-store";
import { postgresDirectPostStore } from "@/lib/direct-post-store";
import { installState, installUrl } from "@/lib/discord";
import { operatorSetting, operatorSettings } from "@/lib/env";
import { headers } from "next/headers";
import { publicOrigin } from "@/lib/origin";
import { postgresSourceStore, TooManySourcesError } from "@/lib/sources-store";
import { type ApproveResult } from "@/lib/approve-drafts";
import { approveChecked, recordApprover } from "@/lib/approve-checked";
import { APPROVED_IN_APP } from "@/lib/rule-origin";
import { recheckDrafts } from "@/lib/save-for-user";


export type RefreshResult = { ok: true } | { ok: false; kind: "limited"; retryAt: string } | { ok: false; kind: "failed" | "signedOut" };

/** Re-reads the signed-in user's Buffer data now (a copy under 30 seconds old is kept). */
export async function refreshBuffer(): Promise<RefreshResult> {
  { const l = await overLimit("bufferWrite"); if (l) return tooManyKind(l); }
  try {
    if (!(await forceRefreshCurrentUser())) return { ok: false, kind: "signedOut" };
  } catch (e) {
    // Signed up with email and no Buffer: there is no Buffer to read, which is not a failure.
    if (e instanceof NoBufferAccount) return { ok: true };
    { const w = waitRefusal(e); if (w) return { ok: false, kind: "limited", retryAt: (w.retryAt ?? new Date(Date.now() + 60_000)).toISOString() }; }
    console.error(JSON.stringify({ event: "qp-refresh-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, kind: "failed" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

/** On success, `note` says the drafts were scheduled in Buffer even though this page could not update its copy yet. */
export type ApproveActionResult = ({ ok: true; note?: string } & ApproveResult) |{ ok: false; kind: "limited"; retryAt: string } | { ok: false; kind: "failed" | "signedOut" };

/** The Approve buttons: schedules the user's own drafts at their slot times, then refreshes the screens. */
export async function approveDrafts(ids: string[], opts?: { one?: boolean }): Promise<ApproveActionResult> {
  { const l = await overLimit("bufferWrite"); if (l) return tooManyKind(l); }
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || ids.some((id) => typeof id !== "string")) return { ok: false, kind: "failed" };
  try {
    const b = await freshBufferForCurrentUser();
    if (!b) return { ok: false, kind: "signedOut" };
    // Read from Buffer now and check the playbook: a draft with an out-of-date check or a broken blocking rule is refused.
    const { approved, refused } = await approveChecked(b.userId, b.token, ids, new Date(), undefined, undefined, b.channels, opts?.one === true && ids.length === 1 ? "one" : "bulk");
    // Buffer has already scheduled these. Failing to update our saved copy must not hide that or skip the records.
    let note: string | undefined;
    try { await b.markScheduled(approved); } catch (e) {
      console.error(JSON.stringify({ event: "qp-approve-mark-failed", message: e instanceof Error ? e.message : String(e) }));
      note = "Scheduled in Buffer. This page may take a minute to show it.";
    }
    if (approved.length) await recordAction(b.userId, "drafts_approved", { via: "app" }, { ids: approved, slots: approved.map((id) => draftSlot(b.posts.find((p) => p.id === id), b.channels)) });
    await recordApprover(b.userId, approved, APPROVED_IN_APP);
    revalidatePath("/", "layout");
    return { ok: true, approved, refused, ...(note ? { note } : {}) };
  } catch (e) {
    { const w = waitRefusal(e); if (w) return { ok: false, kind: "limited", retryAt: (w.retryAt ?? new Date(Date.now() + 60_000)).toISOString() }; }
    console.error(JSON.stringify({ event: "qp-approve-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, kind: "failed" };
  }
}

/** Check again: re-runs the playbook check on the person's own drafts as they are in Buffer now. */
export async function recheckMyDrafts(ids: string[]): Promise<{ ok: true; checked: number } | { ok: false; message: string }> {
  { const l = await overLimit("ai"); if (l) return tooMany(l); }
  if (!Array.isArray(ids) || !ids.length || ids.length > 30 || ids.some((id) => typeof id !== "string")) return { ok: false, message: "Choose up to 30 drafts." };
  try {
    const b = await bufferForWriting();
    if (!b) return { ok: false, message: "Sign in with Buffer first." };
    const ours = await wroteIds(b.userId, ...ids);
    const service = new Map(b.channels.map((c) => [c.id, c.service]));
    const fresh = await readPostsNow(b.token, ids.filter(id => ours.has(id)));
    const drafts = fresh.filter((p) => ours.has(p.id) && p.status === "draft").map((p) => ({ postId: p.id, text: p.text, network: service.get(p.channelId) ?? "", channelId: p.channelId }));
    if (!drafts.length) return { ok: false, message: "Only drafts Queue Pilot wrote can be checked here." };
    const r = await recheckDrafts(b.userId, drafts);
    if (r.ok) {
      const byId = new Map(fresh.map(p => [p.id, p]));
      await patchSavedQueue(b.userId, posts => posts.map(p => byId.get(p.id) ?? p));
      revalidatePath("/", "layout");
    }
    return r;
  } catch (e) {
    { const w = waitRefusal(e); if (w) return { ok: false, message: waitMessage(w) }; }
    console.error(JSON.stringify({ event: "qp-recheck-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Could not check those drafts just now. Try again." };
  }
}

export type SourceActionResult = { ok: true; title?: string; id?: string; next?: NextStep[]; /** For an added feed: how many items it holds and when the newest was published. */ read?: { items: number; newest: string | null } } | { ok: false; message: string };

/** Adds a feed after reading it once to confirm it is a working RSS or Atom feed. */
export async function addSource(url: string): Promise<SourceActionResult> {
  { const l = await overLimit("outbound"); if (l) return tooMany(l); }
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof url !== "string" || url.length > 2000) return { ok: false, message: "That is not a web address." };
  try {
    // The person may paste the site, newsletter or channel page; the feed it points to is what gets saved.
    const feed = await findFeed(url)
    const source = await postgresSourceStore().add(userId, feed.address, feed.title ?? new URL(feed.address).hostname)
    revalidatePath("/", "layout");
    return { ok: true, title: source.title, read: { items: feed.items.length, newest: feed.items[0]?.published ?? null } };
  } catch (e) {
    if (e instanceof TooManySourcesError || e instanceof FeedError) return { ok: false, message: e.message };
    console.error(JSON.stringify({ event: "qp-add-source-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not save that feed. Try again in a minute." };
  }
}

/** Removes one of the signed-in user's feeds. */
export async function removeSource(id: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof id !== "string" || id.length > 100) return { ok: false, message: "Unknown feed." };
  await postgresSourceStore().remove(userId, id);
  revalidatePath("/sources");
  revalidatePath("/settings");
  return { ok: true };
}

export type TelegramConnectInfo = { ok: true; bot: string; code: string } | { ok: false; message: string };

/** What the user posts in their channel to connect it: the bot to add as admin and today's code. */
export async function telegramConnectInfo(): Promise<TelegramConnectInfo> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  const { telegram_bot_token: token, telegram_bot_username: username } = await operatorSettings(["telegram_bot_token", "telegram_bot_username"]);
  const bot = username?.replace(/^@/, "");
  const secret = process.env.SESSION_SECRET;
  if (!token || !bot || !secret) return { ok: false, message: "Telegram copies turn on once Queue Pilot's Telegram bot is set up." };
  return { ok: true, bot, code: connectCodeFor(userId, secret, new Date()) };
}

/** Looks for today's (or yesterday's) code in the bot's recent messages and saves that channel. */
export async function checkTelegramConnect(): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  const token = await operatorSetting("telegram_bot_token");
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret) return { ok: false, message: "Telegram copies turn on once Queue Pilot's Telegram bot is set up." };
  const now = new Date();
  try {
    const codes = postgresTelegramCodes();
    await drainConnectCodes(token, (found) => codes.save(found));
    for (const day of [now, new Date(now.getTime() - 86_400_000)]) {
      const chat = await codes.find(connectCodeFor(userId, secret, day));
      if (chat) {
        await postgresEchoStore().setDestination(userId, { kind: "telegram", label: chat.title, target: String(chat.chatId) });
        revalidatePath("/sources");
  revalidatePath("/settings");
        return { ok: true, title: chat.title };
      }
    }
    return { ok: false, message: "No connect message found yet. Check the bot is an admin of the channel and the code is posted exactly." };
  } catch (e) {
    if (e instanceof TelegramError) return { ok: false, message: `Telegram said: ${e.message}` };
    console.error(JSON.stringify({ event: "qp-telegram-connect-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not check Telegram just now. Try again in a minute." };
  }
}

/** Stops copying to the user's Telegram or Discord channel. */
export async function disconnectEcho(kind: "telegram" | "discord"): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (kind !== "telegram" && kind !== "discord") return { ok: false, message: "Unknown destination." };
  await postgresEchoStore().removeDestination(userId, kind);
  // Posts still waiting to go there would otherwise go out if the same channel or server were connected again later.
  await postgresDirectPostStore().cancelKind(userId, kind, new Date());
  revalidatePath("/sources");
  revalidatePath("/settings");
  return { ok: true };
}

/** The "Add to server" link for Discord, tied to the signed-in user. */
export async function discordInstallLink(): Promise<{ ok: true; url: string } | { ok: false; message: string }> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  const { discord_client_id: clientId, discord_bot_token: botToken } = await operatorSettings(["discord_client_id", "discord_bot_token"]);
  const secret = process.env.SESSION_SECRET;
  if (!clientId || !botToken || !secret) return { ok: false, message: "Discord copies turn on once Queue Pilot's Discord bot is set up." };
  const origin = publicOrigin(await headers());
  return { ok: true, url: installUrl({ clientId, redirectUri: `${origin}/api/discord/callback`, state: installState(userId, secret, new Date()) }) };
}

/** Sets one of Home's offers aside for the signed-in person: "Not now" on the welcome, or × on a connect-your-AI card. */
export async function setOfferAside(key: unknown): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (!isOfferKey(key)) return { ok: false, message: "That offer is not one Queue Pilot shows." };
  try {
    await dismissOffer(userId, key);
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-offer-aside-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not save that just now. Try again in a minute." };
  }
  revalidatePath("/");
  return { ok: true };
}

export type { WriteWeekActionResult } from "@/lib/write-slots-for-user";

/** The "Write drafts with my AI" button: the coming week's empty slots, written by the person's AI, saved as Buffer drafts. */
export async function writeMyWeek(week: "this" | "next" = "next"): Promise<WriteWeekActionResult & { next?: NextStep[] }> {
  return writeSlots(undefined, week === "this" ? "this" : "next");
}

/** "Write it with my AI" on an empty slot: the same run as writeMyWeek, for that one slot. */
export async function writeSlotDraft(slotId: string): Promise<WriteWeekActionResult & { next?: NextStep[] }> {
  if (typeof slotId !== "string" || !parseSlotId(slotId)) return { ok: false, message: "That time is not one of your slots." };
  return writeSlots(slotId);
}

/** Saves the person's own text into one empty slot as a Buffer draft, after the same playbook check as every save. */
export async function saveSlotDraft(slotId: string, text: string): Promise<SourceActionResult> {
  { const l = await overLimit("bufferWrite"); if (l) return tooMany(l); }
  if (typeof slotId !== "string" || !parseSlotId(slotId)) return { ok: false, message: "That time is not one of your slots." };
  if (typeof text !== "string" || !text.trim() || text.length > 25_000) return { ok: false, message: "Write the post first." };
  const unfilled = placeholdersIn(text);
  if (unfilled.length) return { ok: false, message: `Fill in ${unfilled.map((n) => `{{${n}}}`).join(", ")} before saving.` };
  try {
    const b = await bufferForWriting();
    if (!b) return { ok: false, message: "Sign in with Buffer first." };
    const { slots } = openSlots(b.channels, b.posts, b.range);
    if (!slots.some((x) => x.id === slotId)) return { ok: false, message: "That time is no longer empty. Refresh the week." };
    const r = await saveDraftsForUser(b.userId, b.token, { title: "Written in Queue Pilot", drafts: [{ slotId, text: text.trim() }], open: slots, byHand: true });
    if (r.refused.length) return { ok: false, message: r.refused.map((x) => x.reason).join(" ") };
    revalidatePath("/", "layout");
    const flag = r.flags[0];
    // A person writing by hand hears once that the AI they already use can do this for them.
    return { ok: true, title: flag ? `Saved, but check: ${flag.verdict === "fail" ? "it breaks" : "it may break"} "${flag.rule}".` : checkNote(r.check), next: (await suggestionsFor({ saved: 1 })).filter((n) => n.id === "connect-ai") };
  } catch (e) {
    { const w = waitRefusal(e); if (w) return { ok: false, message: waitMessage(w) }; }
    console.error(JSON.stringify({ event: "qp-save-slot-draft-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Could not save the draft just now. Try again." };
  }
}

/** Writes and saves drafts for the coming week's empty slots, or only for one slot. */
async function writeSlots(only?: string, week: "this" | "next" = "next"): Promise<WriteWeekActionResult & { next?: NextStep[] }> {
  { const l = await overLimit("ai"); if (l) return tooMany(l); }
  const result = await writeSlotsForUser(bufferForWriting, only, week);
  revalidatePath("/", "layout");
  return { ...result, next: await suggestionsFor(result.ok ? { saved: result.saved.length } : { saved: 0, reason: result.reason }) };
}

/** The toasts to show after a streamed fill, which ends outside a server action. */
export async function nextStepsAfterFill(saved: number, reason?: "no-material" | "ai-used-up"): Promise<NextStep[]> {
  return suggestionsFor({ saved: Math.max(0, Math.floor(Number(saved) || 0)), reason: reason === "no-material" || reason === "ai-used-up" ? reason : undefined });
}

/** The toasts to show after a run: what this person is still missing. A failed read suggests nothing. */
async function suggestionsFor(run: Parameters<typeof nextSteps>[0]): Promise<NextStep[]> {
  try {
    const userId = await signedInUserId();
    if (!userId) return [];
    const [voice, apps] = await Promise.all([postgresVoiceStore().get(userId), approvedApps(userId)]);
    return nextSteps(run, { hasVoice: voice.examples.length > 0 || !!voice.note, hasAiApp: apps.some((a) => a.lastUsedAt) });
  } catch {
    return [];
  }
}

/** Applies a change Buffer accepted to the saved copy of the queue, so screens show it without another Buffer read. */
async function patchSavedQueue(userId: string, change: (posts: Post[]) => Post[]): Promise<void> {
  try {
    await postgresSnapshotStore().patch(userId, (s) => ({ ...s, data: { ...s.data, posts: change(s.data.posts) } }), new Date());
  } catch (e) {
    console.warn(JSON.stringify({ event: "qp-snapshot-patch-failed", message: e instanceof Error ? e.message : String(e) }));
  }
}

/** Edit in the week dialog: changes the text of a draft Queue Pilot wrote, after the same playbook check as every save. */
export async function editDraftText(postId: string, text: string, expectedText?: string): Promise<SourceActionResult> {
  { const l = await overLimit("bufferWrite"); if (l) return tooMany(l); }
  if (typeof postId !== "string" || typeof text !== "string" || !text.trim() || text.length > 25_000) return { ok: false, message: "Write the new text first." };
  try {
    const b = await bufferForWriting();
    if (!b) return { ok: false, message: "Sign in with Buffer first." };
    let note: string | undefined;
    let check: Awaited<ReturnType<typeof judgeEdit>> | undefined;
    const r = await updateDraft(b.token, postId, text.trim(), b.posts, b.channels, await wroteIds(b.userId, postId), undefined, async (t, network, channelId) => {
      check = await judgeEdit(b.userId, t, network, channelId);
      note = checkNote(check.check);
      return check.refusal;
    }, expectedText);
    if (!r.ok) return { ok: false, message: r.reason };
    // The edit was just checked: keep that check beside what Queue Pilot wrote, so Approve needs no second check.
    if (check?.verdicts) await postgresWrittenStore().recordCheck(b.userId, [{ postId, text: text.trim(), verdicts: check.verdicts, playbookRevision: check.playbookRevision }]).catch((e: unknown) => console.error(JSON.stringify({ event: "qp-edit-check-not-recorded", message: e instanceof Error ? e.message : String(e) })));
    await patchSavedQueue(b.userId, (posts) => posts.map((p) => (p.id === postId ? { ...p, text: text.trim() } : p)));
    revalidatePath("/", "layout");
    return { ok: true, title: note };
  } catch (e) {
    { const w = waitRefusal(e); if (w) return { ok: false, message: waitMessage(w) }; }
    console.error(JSON.stringify({ event: "qp-edit-draft-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Could not change the draft just now. Try again." };
  }
}

/**
 * Move back to draft in the week dialog: takes one scheduled post off the schedule in Buffer and keeps it as a draft.
 * Any of the person's scheduled posts, not only ones Queue Pilot wrote: it is their queue and nothing is lost. The saved
 * copy is updated to draft, which also marks the post as pulled back (left out of Approve all, never scheduled by an AI).
 */
export async function moveBackToDraft(postId: string): Promise<SourceActionResult> {
  { const l = await overLimit("bufferWrite"); if (l) return tooMany(l); }
  if (typeof postId !== "string") return { ok: false, message: "No post given." };
  try {
    const b = await bufferForWriting();
    if (!b) return { ok: false, message: "Sign in with Buffer first." };
    if (!b.posts.some((p) => p.id === postId)) return { ok: false, message: "That post is not in your queue. Refresh and try again." };
    const slot = draftSlot(b.posts.find((p) => p.id === postId), b.channels);
    const r = await moveToDraft(b.token, postId);
    if (!r.ok) return { ok: false, message: r.reason };
    await patchSavedQueue(b.userId, (posts) => posts.map((p) => (p.id === postId ? { ...p, status: "draft" as const } : p)));
    await recordAction(b.userId, "moved_to_draft", { via: "app" }, { ids: [postId], slots: [slot] });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    { const w = waitRefusal(e); if (w) return { ok: false, message: waitMessage(w) }; }
    console.error(JSON.stringify({ event: "qp-move-to-draft-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Could not move it back to draft just now. Nothing changed. Try again." };
  }
}

/** Delete draft in the week dialog: removes a draft Queue Pilot wrote. Never a scheduled or sent post. */
export async function deleteMyDraft(postId: string): Promise<SourceActionResult> {
  { const l = await overLimit("bufferWrite"); if (l) return tooMany(l); }
  if (typeof postId !== "string") return { ok: false, message: "No draft given." };
  try {
    const b = await bufferForWriting();
    if (!b) return { ok: false, message: "Sign in with Buffer first." };
    const slot = draftSlot(b.posts.find((p) => p.id === postId), b.channels);
    const r = await deleteDraft(b.token, postId, b.posts, await wroteIds(b.userId, postId));
    if (!r.ok) return { ok: false, message: r.reason };
    await patchSavedQueue(b.userId, (posts) => posts.filter((p) => p.id !== postId));
    await recordAction(b.userId, "draft_deleted", { via: "app" }, { ids: [postId], slots: [slot] });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    { const w = waitRefusal(e); if (w) return { ok: false, message: waitMessage(w) }; }
    console.error(JSON.stringify({ event: "qp-delete-draft-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Could not delete the draft just now. Try again." };
  }
}

