"use server";

/**
 * @fileoverview The Playbook's same-fix offer: a fix the person made in two drafts on one account, offered as a rule.
 * Finding the repeat costs nothing; whether it is a lasting preference is decided by a model (rule-suggestions.ts),
 * and that answer is saved per set of repeats, so opening the page again does not spend another AI action.
 */
import { revalidatePath } from "next/cache";
import { bufferForWriting, signedInUserId } from "@/lib/current-user";
import { waitMessage, waitRefusal } from "@/lib/buffer/not-sent";
import { AiCapError } from "@/lib/judge-model";
import { limit } from "@/lib/rate-limit";
import { applySuggestion, ruleSuggestions } from "@/lib/rule-suggestions";
import { fixExcerpt } from "@/lib/fix-excerpt";
import type { Fix } from "@/lib/fixes";
import { NETWORKS } from "@/lib/rules";
import type { WriteBuffer } from "@/lib/write-slots-for-user";

/** One repeated fix the model called a lasting preference, ready for the offer card. */
export type RepeatedFix = {
  /** Signed suggestion, for keepRepeatedFix and setRepeatedFixAside. Valid for an hour. */
  token: string;
  /** The rule as it will read in the playbook. */
  rule: string;
  /** How many drafts the fix was made in. */
  drafts: number;
  /** The first edit, trimmed to the changed words. */
  before: string;
  after: string;
  /** The same edit split around the change, for marking it. */
  change?: { lead: string; removed: string; added: string; tail: string };
  /** Where and how often, in one sentence: "On @alex (LinkedIn) you added … at the end of 2 drafts." */
  where: string;
  /** The model's reason for calling it a lasting preference. */
  why?: string;
};

/** The model's answer for the open repeats: the offers it confirmed, and a plain line when it confirmed none. */
export type RepeatedFixesResult = { ok: true; offers: RepeatedFix[]; note: string } | { ok: false; message: string };

type Evidence = { fix?: Fix; channelId?: string; network?: string; count?: number; examples?: { before: string; after: string }[]; why?: string };

const quoted = (s: string) => `"${s.length > 80 ? `${s.slice(0, 79).trimEnd()}…` : s}"`;

/** What the person did, in their words: "changed "a" to "b"", "cut "a"", "added "a" at the end". */
function did(fix: Fix | undefined, count: number): string {
  if (fix?.kind === "replace") return `changed ${quoted(fix.from)} to ${quoted(fix.to)} in ${count} drafts`;
  if (fix?.kind === "banned") return `cut ${quoted(fix.phrase)} from ${count} drafts`;
  if (fix?.kind === "ends_with") return `added ${quoted(fix.phrase)} at the end of ${count} drafts`;
  return `made the same fix in ${count} drafts`;
}

/**
 * The open repeated fixes, judged by the model. Reads Buffer again first so edits made there a moment ago are seen,
 * within the same shared request allowance the Refresh button uses. Asking the model is limited and metered inside
 * ruleSuggestions; a saved answer for the same repeats is reused without an AI action.
 */
export async function checkRepeatedFixes(): Promise<RepeatedFixesResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  const l = await limit("bufferWrite", userId);
  if (!l.ok) return { ok: false, message: `Too many requests just now. Try again in ${l.resetSeconds} seconds.` };
  let b: WriteBuffer | null;
  try {
    b = await bufferForWriting();
  } catch (e) {
    const wait = waitRefusal(e);
    if (wait) return { ok: false, message: waitMessage(wait) };
    console.error(JSON.stringify({ event: "qp-repeated-fixes-refresh-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Buffer did not answer. Try again in a minute." };
  }
  if (!b) return { ok: false, message: "Sign in with Buffer first." };
  const buffer = b;
  try {
    const found = await ruleSuggestions(userId, "fixes", async () => buffer);
    const account = (id?: string) => (id ? buffer.channels.find((c) => c.id === id)?.name : undefined);
    const offers = found.suggestions.map((s): RepeatedFix => {
      const ev = (s.evidence ?? {}) as Evidence;
      const network = NETWORKS[ev.network ?? ""] ?? ev.network ?? "";
      const name = account(ev.channelId);
      const place = name ? `${name} (${network})` : network || "one account";
      const first = ev.examples?.[0];
      const x = first ? fixExcerpt(first.before, first.after) : null;
      const before = x?.before ?? "";
      const after = x?.after ?? "";
      return { token: s.token, rule: s.rule.text, drafts: ev.count ?? s.fixes, before, after, ...(x ? { change: { lead: x.lead, removed: x.removed, added: x.added, tail: x.tail } } : {}), where: `On ${place} you ${did(ev.fix, ev.count ?? s.fixes)}.`, ...(ev.why ? { why: ev.why } : {}) };
    });
    return { ok: true, offers, note: found.note };
  } catch (e) {
    if (e instanceof AiCapError) return { ok: false, message: e.message };
    if (e instanceof Error && e.message.startsWith("AI learning is unavailable")) return { ok: false, message: e.message };
    if (e instanceof Error && (e.name === "TimeoutError" || /aborted due to timeout/i.test(e.message))) return { ok: false, message: "The AI took too long to read your edits. Try again in a minute." };
    console.error(JSON.stringify({ event: "qp-repeated-fixes-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "The AI could not read your edits just now. Try again in a minute." };
  }
}

/** Keeps a confirmed repeated fix as a playbook rule. Checked on every draft from then on. */
export async function keepRepeatedFix(token: string): Promise<{ ok: boolean; message: string }> {
  return settle(token, "keep");
}

/** Sets a repeated fix aside with Not now. The same repeat is not offered again. */
export async function setRepeatedFixAside(token: string): Promise<{ ok: boolean; message: string }> {
  return settle(token, "dismiss");
}

async function settle(token: unknown, action: "keep" | "dismiss"): Promise<{ ok: boolean; message: string }> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof token !== "string" || !token) return { ok: false, message: "That suggestion is invalid or expired. Open the playbook again." };
  try {
    const r = await applySuggestion(userId, token, action);
    if (r.ok) { revalidatePath("/playbook"); revalidatePath("/"); }
    // The connector's wording says to list suggestions again; here the page is the list.
    return { ok: r.ok, message: r.message.replace("List suggestions again.", "Open the playbook again.") };
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-repeated-fix-settle-failed", action, message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not save that just now. Try again in a minute." };
  }
}
