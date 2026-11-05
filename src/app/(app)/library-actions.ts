"use server";

/**
 * @fileoverview The composer's Templates and Hashtags buttons: Buffer's post template library and the organization's
 * saved hashtag sets, read for the organization of the slot being written. Read only; picking one only changes the
 * text in the composer, and the draft still goes through the playbook check when it is saved.
 */
import { BufferApiError } from "@/lib/buffer/client";
import { listSnippets, SnippetsNotAllowedError } from "@/lib/buffer/snippets";
import { listTemplates } from "@/lib/buffer/templates";
import { bufferForReading } from "@/lib/current-user";
import { parseSlotId } from "@/lib/open-slots";

/** A template as the composer lists it. */
export type ComposerTemplate = { id: string; title: string; description: string; emoji: string; body: string; mine: boolean };
/** A saved hashtag set as the composer lists it. */
export type ComposerSnippet = { id: string; name: string; text: string };
type Result<T> = ({ ok: true } & T) | { ok: false; message: string };

const FAILED = "Buffer did not answer. Try again in a minute.";

/** The organization that owns the slot's channel, for the signed-in person only. */
async function slotOrg(slotId: unknown): Promise<{ ok: true; token: string; org: string } | { ok: false; message: string }> {
  const slot = typeof slotId === "string" && slotId.length <= 300 ? parseSlotId(slotId) : null;
  if (!slot) return { ok: false, message: "That time is not one of your slots." };
  const b = await bufferForReading();
  if (!b) return { ok: false, message: "Sign in with Buffer first." };
  const org = b.channels.find((c) => c.id === slot.channelId)?.organizationId;
  if (!org) return { ok: false, message: "Refresh Queue Pilot once so it knows this channel's organization." };
  return { ok: true, token: b.token, org };
}

function failed(e: unknown, event: string): { ok: false; message: string } {
  console.error(JSON.stringify({ event, message: e instanceof Error ? e.message : String(e) }));
  return { ok: false, message: e instanceof BufferApiError && e.status === 401 ? "Your Buffer sign-in expired. Sign in again." : FAILED };
}

/**
 * One batch of the templates the person can use for this slot, their organization's and their own first. `more` and
 * `cursor` say whether Buffer has more and where to continue, so the screen never presents a partial list as whole.
 */
export async function readComposerTemplates(slotId: string, cursor: string | null = null): Promise<Result<{ templates: ComposerTemplate[]; more: boolean; cursor: string | null }>> {
  if (cursor !== null && (typeof cursor !== "string" || cursor.length > 500)) return { ok: false, message: "That list position is not valid. Open the list again." };
  try {
    const s = await slotOrg(slotId);
    if (!s.ok) return s;
    const r = await listTemplates(s.token, s.org, { after: cursor });
    const templates = r.items
      .map((t) => ({ id: t.id, title: t.title, description: t.description, emoji: t.emoji, body: t.body, mine: t.visibility !== "public" }))
      .sort((a, b) => Number(b.mine) - Number(a.mine));
    return { ok: true, templates, more: r.more, cursor: r.cursor };
  } catch (e) {
    return failed(e, "qp-read-templates-failed");
  }
}

/** One batch of the organization's saved hashtag sets for this slot (with where to continue), or why they cannot be read. */
export async function readComposerSnippets(slotId: string, cursor: string | null = null): Promise<Result<{ snippets: ComposerSnippet[]; more: boolean; cursor: string | null }>> {
  if (cursor !== null && (typeof cursor !== "string" || cursor.length > 500)) return { ok: false, message: "That list position is not valid. Open the list again." };
  try {
    const s = await slotOrg(slotId);
    if (!s.ok) return s;
    const r = await listSnippets(s.token, s.org, cursor);
    return { ok: true, snippets: r.items.map((x) => ({ id: x.id, name: x.name, text: x.text })), more: r.more, cursor: r.cursor };
  } catch (e) {
    if (e instanceof SnippetsNotAllowedError) return { ok: false, message: "To use your saved hashtags here, sign out and sign in with Buffer again to allow it." };
    return failed(e, "qp-read-snippets-failed");
  }
}
