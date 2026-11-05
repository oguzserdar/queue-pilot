"use server";

/**
 * @fileoverview The "New post for several accounts" composer: write once, choose accounts, review each account's
 * version, save one Buffer draft per account. Runs the same flow as the connector's promote_to_draft_posts
 * (src/lib/content-item-flow.ts): each version is checked against that account's own limit and rules first, every post
 * is saved as a draft, and nothing schedules or publishes.
 */
import { BufferRateLimitedError } from "@/lib/buffer/client";
import { textLimits } from "@/lib/buffer/workspace";
import { contentItemFlow, type ItemBuffer } from "@/lib/content-item-flow";
import { bufferForReading } from "@/lib/current-user";
import { limit } from "@/lib/rate-limit";
import { limitFor } from "@/lib/char-limits";
import { placeholdersIn } from "@/lib/placeholders";
import { revalidatePath } from "next/cache";

/** One connected account as the composer shows it, with its own text limit. */
export type ComposerAccount = { id: string; name: string; service: string; limit: number | null; limitFrom: "buffer" | "built-in"; disconnected: boolean };
type Result<T> = ({ ok: true } & T) | { ok: false; message: string; refused?: { channelId: string; reason: string }[] };

const FAILED = "Buffer did not answer. Try again in a minute.";
const MAX_TEXT = 10_000;

/** The person's connected accounts with each one's post text limit, read from Buffer's configuration when it states one. */
export async function readComposerAccounts(): Promise<Result<{ accounts: ComposerAccount[] }>> {
  try {
    const b = await bufferForReading();
    if (!b) return { ok: false, message: "Sign in with Buffer first." };
    const orgs = [...new Set(b.channels.map((c) => c.organizationId).filter((o): o is string => Boolean(o)))];
    const limits = await textLimits(b.token, orgs);
    return {
      ok: true,
      accounts: b.channels.map((c) => {
        const own = limits.get(c.id);
        return { id: c.id, name: c.name, service: c.service, limit: own ?? limitFor(c.service), limitFrom: own ? "buffer" : "built-in", disconnected: c.isDisconnected };
      }),
    };
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-read-composer-accounts-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: FAILED };
  }
}

/**
 * Saves one Buffer draft per chosen account. The main text is first kept in Buffer as a draft without accounts (one
 * content item, found again by requestId on a retry), then turned into one checked draft per account.
 *
 * @param input - requestId (a UUID the composer keeps for this post), the main text, an optional title, each
 *   account's version, and previousText: the main text this composer sent with the same requestId before, if any
 *   (a retry updates Buffer's copy only while Buffer still holds exactly that text, so an edit made in Buffer is kept)
 * @returns How many drafts were saved, or why not (with each refused account's reason)
 */
export async function saveForAccounts(input: { requestId: string; text: string; title?: string; versions: { channelId: string; text: string }[]; previousText?: string }): Promise<Result<{ saved: number; message: string }>> {
  const { requestId, text, title, versions, previousText } = input ?? ({} as never);
  if (previousText !== undefined && (typeof previousText !== "string" || previousText.length > MAX_TEXT)) return { ok: false, message: "Open the composer again and retry." };
  if (typeof requestId !== "string" || !/^[0-9a-f-]{36}$/i.test(requestId)) return { ok: false, message: "Open the composer again and retry." };
  if (typeof text !== "string" || !text.trim() || text.length > MAX_TEXT) return { ok: false, message: "Write the post first." };
  if (title !== undefined && (typeof title !== "string" || title.length > 200)) return { ok: false, message: "Shorten the title." };
  if (!Array.isArray(versions) || !versions.length || versions.length > 10) return { ok: false, message: "Choose at least one account." };
  if (versions.some((v) => typeof v?.channelId !== "string" || typeof v?.text !== "string" || !v.text.trim() || v.text.length > MAX_TEXT)) return { ok: false, message: "Every chosen account needs text." };
  const unfilled = [...new Set(versions.flatMap((v) => placeholdersIn(v.text)))];
  if (unfilled.length) return { ok: false, message: `Fill in ${unfilled.map((n) => `{{${n}}}`).join(", ")} before saving.` };
  try {
    const r = await bufferForReading();
    if (!r) return { ok: false, message: "Sign in with Buffer first." };
    // The same per-person Buffer write budget as every other save.
    const l = await limit("bufferWrite", r.userId);
    if (!l.ok) return { ok: false, message: "Too many requests just now. Try again in a minute." };
    const b: ItemBuffer = { token: r.token, channels: r.channels, posts: r.posts, organizationIds: [...new Set(r.channels.map((c) => c.organizationId).filter((o): o is string => Boolean(o)))] };
    const orgs = [...new Set(versions.map((v) => b.channels.find((c) => c.id === v.channelId)?.organizationId))];
    if (orgs.length !== 1 || !orgs[0]) return { ok: false, message: "Choose accounts from one Buffer organization." };
    const flow = contentItemFlow(r.userId);
    // Keep the main text in Buffer first. The same requestId finds the same item again after an unclear answer.
    const saved = await flow.save(b, { text: text.trim(), title: title?.trim() || undefined, requestId, organizationId: orgs[0] });
    if (saved.isError || !saved.item) return { ok: false, message: plain(saved.text) };
    let item = saved.item;
    // A retry with edited text found the first item. Update it only while Buffer still holds what this composer sent
    // last time; anything else is an edit made in Buffer, which is kept.
    if (item.body.kind === "draft" && item.body.text.trim() !== text.trim()) {
      if (previousText === undefined || item.body.text.trim() !== previousText.trim()) return { ok: false, message: "This post was changed in Buffer after your last save here, so Queue Pilot leaves it alone. Open it in Buffer, or close this and start a new post." };
      const updated = await flow.save(b, { contentItemId: item.id, text: text.trim(), expectedText: previousText.trim() });
      if (updated.isError || !updated.item) return { ok: false, message: plain(updated.text) };
      item = updated.item;
    }
    const promoted = await flow.promote(b, { contentItemId: item.id, expectedDraftText: text.trim(), versions: versions.map((v) => ({ channelId: v.channelId, text: v.text.trim() })) });
    revalidatePath("/", "layout");
    if (promoted.refused?.length) return { ok: false, message: "No account drafts were created. Fix these versions:", refused: promoted.refused };
    if (promoted.isError) return { ok: false, message: plain(promoted.text) };
    const n = promoted.created ?? versions.length;
    return { ok: true, saved: n, message: `Saved ${n} draft${n === 1 ? "" : "s"} in Buffer. Nothing was scheduled.` };
  } catch (e) {
    if (e instanceof BufferRateLimitedError) return { ok: false, message: "Buffer asked us to wait a moment. Try again in a minute." };
    console.error(JSON.stringify({ event: "qp-save-for-accounts-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Buffer did not answer clearly. Press Save again: the same post is found, never saved twice." };
  }
}

/** The flow's assistant-facing text, without the ids and markup a person does not need. */
function plain(text: string): string {
  return text.split("\n")[0].replace(/ Read get_content_item[^.]*\./, "").replace(/content item id \S+/g, "").trim();
}


