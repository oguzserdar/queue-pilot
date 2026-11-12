"use server";

import { placeholdersIn } from "@/lib/placeholders";

import { revalidatePath } from "next/cache";
import { waitMessage, waitRefusal } from "@/lib/buffer/not-sent";
import { nextSteps, type NextStep } from "@/lib/next-step";
import { bufferForWriting, forceRefreshCurrentUser, freshBufferForCurrentUser, signedInUserId } from "@/lib/current-user";
import { postgresAiKeyStore, providerOf } from "@/lib/ai-key-store";
import { writeSlotsForUser, type WriteWeekActionResult } from "@/lib/write-slots-for-user";
import { aiErrorMessage } from "@/lib/ai-model";
import { APICallError, NoObjectGeneratedError } from "ai";
import { listModels, ModelListError } from "@/lib/ai-models";
import { openSlots, parseSlotId } from "@/lib/open-slots";
import { checkNote, judgeEdit, saveDraftsForUser } from "@/lib/save-for-user";
import { deleteDraft, updateDraft } from "@/lib/edit-drafts";
import { draftSlot, recordAction } from "@/lib/security-events";
import { postgresWrittenStore, wroteIds } from "@/lib/written-store";
import { APPROVE_MODES, setApproveMode, type ApproveMode } from "@/lib/agent-permission";
import { listRecentSent, readPostsNow, type Post } from "@/lib/buffer/queries";
import { FeedError, findFeed } from "@/lib/feeds"
import { approvedApps, removeUnusedApps, renameApp, revokeApp } from "@/lib/ai-access";
import { MAX_LABEL } from "@/lib/ai-app-limits";
import { getAuth } from "@/lib/auth";
import { deleteAccount, LastAdminError } from "@/lib/delete-account";
import { dismissOffer, isOfferKey } from "@/lib/offer-store";
import { addPastedExample, exampleFromQueue, InvalidVoiceExampleError, MAX_NOTE, postgresVoiceStore, TooManyExamplesError } from "@/lib/voice-store"
import { postgresSnapshotStore } from "@/lib/buffer/snapshot-store";
import { TelegramError, connectCodeFor, drainConnectCodes } from "@/lib/telegram";
import { postgresEchoStore, postgresTelegramCodes } from "@/lib/echo-store";
import { clearSignInCookies } from "@/lib/sign-in-cookies";
import { postgresDirectPostStore } from "@/lib/direct-post-store";
import { installState, installUrl } from "@/lib/discord";
import { operatorSetting, operatorSettings } from "@/lib/env";
import { cookies, headers } from "next/headers";
import { publicOrigin } from "@/lib/origin";
import { postgresSourceStore, TooManySourcesError } from "@/lib/sources-store";
import { type ApproveResult } from "@/lib/approve-drafts";
import { approveChecked, recordApprover } from "@/lib/approve-checked";
import { APPROVED_IN_APP } from "@/lib/rule-origin";
import { recheckDrafts } from "@/lib/save-for-user";
import { postgresRulesStore, TooManyRulesError } from "@/lib/rules-store";
import { NETWORKS, parseNewRule, type NewRule, ruleInput } from "@/lib/rules";
import { structureRule } from "@/lib/structure-rule";
import { judgeDrafts, type Verdict } from "@/lib/judge";
import { AiCapError, judgeModelFor } from "@/lib/judge-model";
import { limit, type Action, type Limited } from "@/lib/rate-limit";
import { currentRewrites } from "@/lib/read-back";
import { proposeRules } from "@/lib/rewrite-rules";
import { channelsByOrganization, firstRuleKey, pastPosts, proposeFirstRules } from "@/lib/day-one-rules";

/** The signed-in person's limit for this action (src/lib/rate-limit.ts), or null while they are within it. */
async function overLimit(action: Action): Promise<Limited | null> {
  const userId = await signedInUserId();
  if (!userId) return null;
  const l = await limit(action, userId);
  return l.ok ? null : l;
}
const tooMany = (l: Limited) => ({ ok: false as const, message: `Too many requests just now. Try again in ${l.resetSeconds} seconds.` });
const tooManyKind = (l: Limited) => ({ ok: false as const, kind: "limited" as const, retryAt: new Date(Date.now() + l.resetSeconds * 1000).toISOString() });

export type RefreshResult = { ok: true } | { ok: false; kind: "limited"; retryAt: string } | { ok: false; kind: "failed" | "signedOut" };

/** Re-reads the signed-in user's Buffer data now (a copy under 30 seconds old is kept). */
export async function refreshBuffer(): Promise<RefreshResult> {
  { const l = await overLimit("bufferWrite"); if (l) return tooManyKind(l); }
  try {
    if (!(await forceRefreshCurrentUser())) return { ok: false, kind: "signedOut" };
  } catch (e) {
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
export async function approveDrafts(ids: string[]): Promise<ApproveActionResult> {
  { const l = await overLimit("bufferWrite"); if (l) return tooManyKind(l); }
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100 || ids.some((id) => typeof id !== "string")) return { ok: false, kind: "failed" };
  try {
    const b = await freshBufferForCurrentUser();
    if (!b) return { ok: false, kind: "signedOut" };
    // Read from Buffer now and check the playbook: a draft with an out-of-date check or a broken blocking rule is refused.
    const { approved, refused } = await approveChecked(b.userId, b.token, ids, new Date(), undefined, undefined, b.channels);
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

/** Picks one of the user's own sent posts as a voice example. The text is read from their saved queue, never from the browser. */
export async function addVoiceExample(postId: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof postId !== "string" || postId.length > 200) return { ok: false, message: "Unknown post." };
  try {
    const snap = await postgresSnapshotStore().get(userId);
    const example = snap ? exampleFromQueue(snap.data, postId) : null;
    if (!example) return { ok: false, message: "That post is not in your recent sent posts." };
    await postgresVoiceStore().addExample(userId, example);
  } catch (e) {
    if (e instanceof TooManyExamplesError) return { ok: false, message: e.message };
    console.error(JSON.stringify({ event: "qp-voice-add-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not save that just now. Try again in a minute." };
  }
  revalidatePath("/voice");
  return { ok: true };
}

/** Saves a post the signed-in person pasted to teach their writing style. */
export async function addPastedVoiceExample(text: string): Promise<SourceActionResult> {
  const userId = await signedInUserId()
  if (!userId) return { ok: false, message: "Sign in with Buffer first." }
  try {
    await addPastedExample(postgresVoiceStore(), userId, text)
  } catch (e) {
    if (e instanceof TooManyExamplesError || e instanceof InvalidVoiceExampleError) return { ok: false, message: e.message }
    console.error(JSON.stringify({ event: "qp-voice-paste-failed", message: e instanceof Error ? e.message : String(e) }))
    return { ok: false, message: "Could not save that just now. Try again in a minute." }
  }
  revalidatePath("/voice")
  return { ok: true }
}

/** Stops using one post as a voice example. */
export async function removeVoiceExample(postId: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof postId !== "string" || postId.length > 200) return { ok: false, message: "Unknown post." };
  try {
    await postgresVoiceStore().removeExample(userId, postId);
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-voice-remove-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not remove that just now. Try again in a minute." };
  }
  revalidatePath("/voice");
  return { ok: true };
}

/** Saves the user's note on how they write; an empty note clears it. */
export async function saveVoiceNote(note: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof note !== "string" || note.length > MAX_NOTE) return { ok: false, message: `Keep the note to ${MAX_NOTE} characters.` }
  try {
    await postgresVoiceStore().setNote(userId, note);
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-voice-note-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not save your note just now. Try again in a minute." };
  }
  revalidatePath("/voice");
  return { ok: true };
}

/** Revokes one AI app's access to the signed-in user's Queue Pilot (approval and tokens). */
export async function revokeAiApp(consentId: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof consentId !== "string" || consentId.length > 200) return { ok: false, message: "Unknown app." };
  try {
    if (!(await revokeApp(userId, consentId))) return { ok: false, message: "That app is not connected to your account." };
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-revoke-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not revoke it just now. Try again in a minute." };
  }
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Names one of the person's AI app connections so it can be told apart from another of the same app. */
export async function renameAiApp(consentId: string, label: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof consentId !== "string" || consentId.length > 200 || typeof label !== "string") return { ok: false, message: "Unknown app." };
  if (label.trim().length > MAX_LABEL) return { ok: false, message: `Keep the name under ${MAX_LABEL} characters.` };
  try {
    if (!(await renameApp(userId, consentId, label))) return { ok: false, message: "That app is not connected to your account." };
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-rename-app-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not save the name just now. Try again in a minute." };
  }
  revalidatePath("/settings");
  return { ok: true };
}

/** Removes every AI app connection that has gone unused long enough to stop working. */
export async function removeUnusedAiApps(): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  try {
    const removed = await removeUnusedApps(userId);
    revalidatePath("/settings");
    revalidatePath("/", "layout");
    return { ok: true, title: removed === 1 ? "Removed 1 unused connection." : `Removed ${removed} unused connections.` };
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-remove-unused-apps-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not remove them just now. Try again in a minute." };
  }
}

/** Signs this person out of Queue Pilot on every other browser; this one stays signed in. */
export async function signOutOtherDevices(): Promise<SourceActionResult> {
  { const l = await overLimit("account"); if (l) return tooMany(l); }
  if (!(await signedInUserId())) return { ok: false, message: "Sign in with Buffer first." };
  const auth = await getAuth();
  if (!auth) return { ok: false, message: "Queue Pilot is not open yet." };
  try {
    await auth.api.revokeOtherSessions({ headers: await headers() });
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-revoke-sessions-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not sign out the other browsers just now. Try again in a minute." };
  }
  revalidatePath("/settings");
  return { ok: true };
}

/** Deletes everything Queue Pilot stores for the signed-in person. The browser must send the word "delete". */
export async function deleteMyAccount(confirm: string): Promise<SourceActionResult> {
  { const l = await overLimit("account"); if (l) return tooMany(l); }
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof confirm !== "string" || confirm.trim().toLowerCase() !== "delete") return { ok: false, message: "Type delete to confirm." };
  try {
    await deleteAccount(userId, process.env.SESSION_SECRET);
  } catch (e) {
    if (e instanceof LastAdminError) return { ok: false, message: e.message };
    console.error(JSON.stringify({ event: "qp-delete-account-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not delete your account just now. Nothing was removed. Try again in a minute." };
  }
  // The account and its sessions are gone, but this browser still holds the sign-in cookie. The router only checks
  // that the cookie exists, so clear it here or the person stays "signed in" to an empty app instead of the homepage.
  const jar = await cookies();
  clearSignInCookies(jar.getAll(), jar);
  return { ok: true };
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

/** Adds a rule to the signed-in user's playbook. Every draft is checked against it before it is saved in Buffer. */
export async function addRule(input: unknown): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  const parsed = parseNewRule(input);
  if (typeof parsed === "string") return { ok: false, message: parsed };
  let id: string;
  try {
    id = await postgresRulesStore().add(userId, { ...(await readingOrTyped(userId, parsed, (input as { reading?: unknown }).reading)), addedBy: "you" });
  } catch (e) {
    if (e instanceof TooManyRulesError) return { ok: false, message: e.message };
    console.error(JSON.stringify({ event: "qp-rule-add-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not save that rule just now. Try again in a minute." };
  }
  revalidatePath("/playbook");
  return { ok: true, id };
}

/**
 * The reading the person saw while typing, when the form sends one: a typed reading is checked like any input and keeps
 * their sentence as its text, and a "guidance" reading means they chose to keep the rule as written. Without one, the
 * rule is read on the server.
 */
async function readingOrTyped(userId: string, rule: NewRule, reading: unknown): Promise<NewRule> {
  if (rule.kind !== "guidance" || !reading || typeof reading !== "object") return typedIfPossible(userId, rule);
  if ((reading as { kind?: unknown }).kind === "guidance") return rule;
  // A reading the form saw is a whole rule (a banned one holds `phrases`); turn it back into parser input before checking it.
  const raw = reading as Record<string, unknown>;
  const input = raw.kind === "banned" && Array.isArray(raw.phrases) ? ruleInput(raw as NewRule) : raw;
  const typed = parseNewRule({ ...input, channels: rule.channels, accountIds: rule.accountIds, except: rule.except, overrides: rule.overrides, level: rule.level });
  return typeof typed === "string" || typed.kind === "guidance" ? typedIfPossible(userId, rule) : { ...typed, text: rule.text };
}

/** How a rule in the person's words reads, for the form to show while they type; null when it cannot be read now. */
export async function readRule(text: unknown): Promise<NewRule | null> {
  const userId = await signedInUserId();
  if (!userId || typeof text !== "string" || text.trim().length < 4 || text.length > 200) return null;
  const parsed = parseNewRule({ kind: "guidance", text, channels: "all", level: "warn" });
  if (typeof parsed === "string") return null;
  // The live preview runs while the person types, so it never spends the built-in key: only their own key previews.
  return typedIfPossible(userId, parsed, { ownKeyOnly: true });
}

/** A rule in the person's words read into a typed rule with their AI; kept as written without a key, over the limit, or on any failure. */
async function typedIfPossible(userId: string, rule: NewRule, opts: { ownKeyOnly?: boolean } = {}): Promise<NewRule> {
  if (rule.kind !== "guidance" || (await overLimit("ai"))) return rule;
  const jm = await judgeModelFor(userId, opts).catch(() => null);
  if (!jm) return rule;
  try {
    return await structureRule(jm.judges.explainer, rule);
  } finally {
    await jm.settle();
  }
}

/** Deletes one of the signed-in user's rules; another person's rule id deletes nothing. */
export async function removeRule(id: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof id !== "string" || id.length > 100) return { ok: false, message: "Unknown rule." };
  try {
    await postgresRulesStore().remove(userId, id);
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-rule-remove-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not delete that rule just now. Try again in a minute." };
  }
  revalidatePath("/playbook");
  return { ok: true };
}

/** Switches one of the person's shared rules off for a network, or back on. */
export async function setRuleException(id: string, network: string, off: boolean): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof id !== "string" || id.length > 100 || typeof network !== "string" || !(network in NETWORKS) || typeof off !== "boolean") return { ok: false, message: "Unknown rule." };
  try {
    if (!(await postgresRulesStore().setException(userId, id, network, off))) return { ok: false, message: "Only a rule for every network can be switched off for one." };
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-rule-exception-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not change that rule just now. Try again in a minute." };
  }
  revalidatePath("/playbook");
  return { ok: true };
}

const aiKeys = () => {
  const master = process.env.SETTINGS_KEY;
  return master ? postgresAiKeyStore(master) : null;
};

/** Saves the person's own AI key, encrypted; the provider is read from the key's prefix. */
export async function saveAiKey(input: string): Promise<SourceActionResult> {
  { const l = await overLimit("outbound"); if (l) return tooMany(l); }
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  const key = typeof input === "string" ? input.trim() : "";
  const provider = providerOf(key);
  if (!provider) return { ok: false, message: "That does not look like an Anthropic key (sk-ant-…), an OpenAI key (sk-…) or an OpenRouter key (sk-or-v1-…)." };
  const store = aiKeys();
  if (!store) return { ok: false, message: "This copy of Queue Pilot cannot store keys yet (SETTINGS_KEY is not set)." };
  // Listing the key's models checks the key works and gives the default model, before anything is stored.
  let list;
  try {
    list = await listModels(provider, key);
  } catch (e) {
    return { ok: false, message: e instanceof ModelListError ? e.message : "Could not check the key just now. Try again." };
  }
  if (!list.recommended) return { ok: false, message: "This key cannot use any text model." };
  try {
    await store.set(userId, provider, key, list.recommended);
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-ai-key-save-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Could not save the key just now. Try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeAiKey(): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  const store = aiKeys();
  if (!userId || !store) return { ok: false, message: "Sign in with Buffer first." };
  await store.remove(userId).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Settings → AI: whether connected apps may approve drafts, and whether they must ask first. Only this screen sets it. */
export async function setAgentApproveMode(mode: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (!APPROVE_MODES.includes(mode as ApproveMode)) return { ok: false, message: "Unknown choice." };
  try { await setApproveMode(userId, mode as ApproveMode); }
  catch (e) {
    console.error(JSON.stringify({ event: "qp-approve-mode-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "That didn't save. Try again." };
  }
  revalidatePath("/settings");
  return { ok: true };
}

/** Changes the model for the saved key, after checking the provider still lists it for this key. */
export async function setAiModel(model: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  const store = aiKeys();
  if (!userId || !store) return { ok: false, message: "Sign in with Buffer first." };
  const cfg = await store.get(userId).catch(() => null);
  if (!cfg) return { ok: false, message: "Add your AI key first." };
  try {
    const list = await listModels(cfg.provider, cfg.key);
    if (!list.models.some((m) => m.id === model)) return { ok: false, message: "That model is not available to this key." };
    await store.setModel(userId, model);
  } catch (e) {
    return { ok: false, message: e instanceof ModelListError ? e.message : "Could not change the model just now. Try again." };
  }
  revalidatePath("/", "layout");
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

export type TryDraftResult = { ok: true; verdicts: Verdict[]; judgedWith: string } | { ok: false; message: string };

/** Try a draft: judges typed text against the person's playbook with the same model check saves get. */
export async function tryDraft(text: string, network: string, channelId?: string): Promise<TryDraftResult> {
  { const l = await overLimit("ai"); if (l) return tooMany(l); }
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof text !== "string" || !text.trim() || text.length > 5000 || typeof network !== "string" || !(network in NETWORKS)) return { ok: false, message: "Type a draft to check." };
  const snapshot = await postgresSnapshotStore().get(userId);
  const channels = snapshot?.data.channels.filter(c => c.service === network) ?? [];
  const channel = channelId ? channels.find(c => c.id === channelId) : channels.length === 1 ? channels[0] : undefined;
  if (!channel) return { ok: false, message: "Choose the connected account this draft is for." };
  const rules = await postgresRulesStore().list(userId).catch(() => null);
  if (!rules) return { ok: false, message: "Could not read your playbook just now. Try again." };
  if (!rules.length) return { ok: false, message: "Your playbook has no rules yet." };
  const jm = await judgeModelFor(userId).catch((e) => (e instanceof AiCapError ? e : null));
  if (jm instanceof AiCapError) return { ok: false, message: jm.message };
  if (!jm) return { ok: false, message: "Add your AI key in Settings: a model judges each draft against your rules." };
  try {
    const v = await judgeDrafts(jm.judges, [{ slotId: "try", text, network, channelId: channel.id }], rules);
    return { ok: true, verdicts: v.get("try") ?? [], judgedWith: jm.source };
  } catch (e) {
    await jm.giveBack();
    return { ok: false, message: aiErrorMessage(e, jm.cfg.provider) };
  } finally {
    await jm.settle();
  }
}

export type RewriteProposal = { accountIds?: string[]; text: string; channels: string[] | "all"; where: string; examples: { before: string; after: string }[] };

/** Find rules in my rewrites: a model reads the drafts the person rewrote and proposes rules they can keep. */
export async function findRulesInRewrites(): Promise<{ ok: true; proposals: RewriteProposal[]; read: number } | { ok: false; message: string }> {
  { const l = await overLimit("ai"); if (l) return tooMany(l); }
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  const { rewrites, rules } = await currentRewrites(userId).catch(() => ({ rewrites: [], rules: [] }));
  if (rewrites.length < 2) return { ok: false, message: "Rewrite at least two of Queue Pilot's drafts in Buffer first. Small fixes are offered above on their own." };
  const jm = await judgeModelFor(userId).catch((e) => (e instanceof AiCapError ? e : null));
  if (jm instanceof AiCapError) return { ok: false, message: jm.message };
  if (!jm) return { ok: false, message: "Add your AI key in Settings: a model reads your rewrites." };
  try {
    const found = await proposeRules(jm.judges.explainer, rewrites, rules);
    return {
      ok: true,
      read: rewrites.length,
      proposals: found.map((p) => ({
        text: p.rule.text,
        channels: p.rule.channels,
        accountIds: p.rule.accountIds,
        where: p.rule.accountIds?.length ? "Selected account" : p.rule.channels === "all" ? "Every network" : p.rule.channels.map((c) => NETWORKS[c] ?? c).join(", "),
        examples: p.evidence.map((e) => ({ before: e.before, after: e.after })),
      })),
    };
  } catch (e) {
    await jm.giveBack();
    return { ok: false, message: aiErrorMessage(e, jm.cfg.provider) };
  } finally {
    await jm.settle();
  }
}

export type FirstRuleOffer = {
  accountIds?: string[];
  text: string;
  channels: string[];
  where: string;
  key: string;
  proof: { kind: "posts"; followed: number; of: number; unclear: number; unclearPosts: string[]; examples: string[] } | { kind: "note"; note: string; by: string | null; at: string | null; post: string };
};

/** Find my first rules: a model reads the person's recent sent posts and their teammates' notes in Buffer, and each rule comes back with its proof. */
export async function findFirstRules(): Promise<{ ok: true; offers: FirstRuleOffer[]; skipped: string[] } | { ok: false; message: string }> {
  { const l = await overLimit("ai"); if (l) return tooMany(l); }
  const b = await bufferForWriting().catch((e) => waitRefusal(e) ?? null);
  if (b && "message" in b) return { ok: false, message: waitMessage(b) };
  if (!b) return { ok: false, message: "Sign in with Buffer first." };
  const jm = await judgeModelFor(b.userId).catch((e) => (e instanceof AiCapError ? e : null));
  if (jm instanceof AiCapError) return { ok: false, message: jm.message };
  if (!jm) return { ok: false, message: "Add your AI key in Settings: a model reads your posts." };
  try {
    const sent = (await Promise.all([...channelsByOrganization(b.channels)].map(([org, ids]) => listRecentSent(b.token, org, ids)))).flat();
    if (!sent.length) return { ok: false, message: "Buffer has no sent posts for your channels yet." };
    // Posts Queue Pilot wrote are not the person's voice, so they teach nothing.
    const ours = await wroteIds(b.userId, ...sent.map((p) => p.id));
    const [rules, dismissed] = await Promise.all([postgresRulesStore().list(b.userId).catch(() => []), postgresRulesStore().dismissed(b.userId).catch(() => new Set<string>())]);
    const { offers, skipped } = await proposeFirstRules(jm.judges.explainer, jm.judges, pastPosts(b.channels, sent.filter((p) => !ours.has(p.id))), rules);
    return {
      ok: true,
      skipped: skipped.map((n) => NETWORKS[n] ?? n),
      offers: offers.filter(({ rule }) => !dismissed.has(firstRuleKey(rule))).map(({ rule, proof }) => {
        const channels = rule.channels === "all" ? [] : rule.channels;
        return {
          text: rule.text,
          accountIds: rule.accountIds,
          channels,
          where: rule.accountIds?.length ? rule.accountIds.map(id => b.channels.find(c => c.id === id)?.name ?? "Account").join(", ") : channels.map((c) => NETWORKS[c] ?? c).join(", "),
          key: firstRuleKey(rule),
          proof,
        };
      }),
    };
  } catch (e) {
    { const w = waitRefusal(e); if (w) return { ok: false, message: waitMessage(w) }; }
    await jm.giveBack();
    if (APICallError.isInstance(e) || NoObjectGeneratedError.isInstance(e)) return { ok: false, message: aiErrorMessage(e, jm.cfg.provider) };
    console.error(JSON.stringify({ event: "qp-first-rules-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Could not read your posts just now. Try again." };
  } finally {
    await jm.settle();
  }
}

/** Not now on a first rule: it is not offered again. */
export async function dismissFirstRule(key: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof key !== "string" || !key.startsWith("first:") || key.length > 500) return { ok: false, message: "Unknown rule." };
  try {
    await postgresRulesStore().dismiss(userId, key);
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-dismiss-first-rule-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not save that just now. Try again in a minute." };
  }
  return { ok: true };
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

