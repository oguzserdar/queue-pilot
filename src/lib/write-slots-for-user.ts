/** Shared built-in writer for the browser action and authenticated connector. */
import { BufferRateLimitedError } from "./buffer/client";
import type { Channel, Post } from "./buffer/queries";
import type { Provider } from "./ai-key-store";
import { writeDrafts } from "./ai-writer";
import { aiErrorMessage } from "./ai-model";
import { APICallError, NoObjectGeneratedError } from "ai";
import { ModelListError } from "./ai-models";
import { slotsToWrite, writeWeek } from "./write-week";
import { newMaterial } from "./new-material";
import { openSlots } from "./open-slots";
import { checkNote, saveDraftsForUser } from "./save-for-user";
import { youtubeTranscript } from "./transcripts";
import { supadataKey } from "./env";
import { postgresVoiceStore } from "./voice-store";
import { postgresRulesStore } from "./rules-store";
import { AiCapError, aiFor } from "./judge-model";
export type WriteBuffer = { userId: string; token: string; channels: Channel[]; posts: Post[]; timeZone: string; range: { start: Date; end: Date } };
export type WriteWeekActionResult =
  | { ok: true; saved: { local: string; channel: string }[]; refused: { slotId: string; reason: string }[]; retried: number; flags: { where: string; rule: string; verdict: "fail" | "unsure"; reason: string }[]; note?: string }
  | { ok: false; message: string };

export async function writeSlotsForUser(loadBuffer: () => Promise<WriteBuffer | null>, only?: string): Promise<WriteWeekActionResult> {
  let provider: Provider = "anthropic";
  let giveBack = async () => {};
  let settle = async () => {};
  try {
    const b = await loadBuffer();
    if (!b) return { ok: false, message: "Sign in with Buffer first." };
    // Checked before an AI action is taken, so a click with nothing to write costs the person nothing.
    const open = openSlots(b.channels, b.posts, b.range).slots;
    const now = new Date();
    const slots = slotsToWrite(open, now, b.timeZone, only);
    if (only && !slots.length) return { ok: false, message: "That time is no longer empty. Refresh the week." };
    if (!slots.length) return { ok: false, message: "No known empty times next week. Sync with Buffer and check the week." };
    const ai = await aiFor(b.userId);
    if (ai) { giveBack = ai.giveBack; settle = ai.settle; }
    if (!ai) return { ok: false, message: "AI writing is unavailable just now. Check built-in AI or your own key in Settings." };
    provider = ai.cfg.provider;
    const model = ai.language;
    const supadata = await supadataKey();
    const r = await writeWeek(slots, now, {
      material: async () => {
        const items = await newMaterial(b.userId);
        // A YouTube item carries only its description; with a Supadata key the transcript is added.
        return Promise.all(items.map(async (m) => (supadata && m.url && /youtu\.?be/.test(m.url) ? { ...m, text: `${m.text}\n\nTranscript:\n${(await youtubeTranscript(m.url, supadata)) ?? "(none)"}` } : m)));
      },
      voice: () => postgresVoiceStore().get(b.userId),
      rules: () => postgresRulesStore().list(b.userId),
      write: (brief) => writeDrafts(model, brief),
      // The playbook check is part of this one action, so it judges with the same AI instead of taking another.
      save: (drafts, sourceKeys) => saveDraftsForUser(b.userId, b.token, { title: "Written by Queue Pilot", drafts, open: slots, sourceKeys }, { ...ai, judges: { decider: ai.decider, explainer: ai.language } }),
    });
    if (r.kind === "nothing") {
      await giveBack();
      return { ok: false, message: r.reason === "no-slots" ? "No empty times remain in the chosen week." : "No new material to write from. Add research under New material or connect a feed." };
    }
    const where = (slotId: string) => { const s = r.saved.find((x) => x.slotId === slotId); return s ? `${s.local} · ${s.channel}` : slotId; };
    return {
      ok: true,
      saved: r.saved.map((s) => ({ local: s.local, channel: s.channel })),
      refused: r.refused,
      retried: r.retried,
      flags: r.flags.map((f) => ({ where: where(f.slotId), rule: f.rule, verdict: f.verdict, reason: f.reason })),
      note: checkNote(r.check),
    };
  } catch (e) {
    if (e instanceof AiCapError || e instanceof ModelListError) return { ok: false, message: e.message };
    if (e instanceof BufferRateLimitedError) {
      await giveBack();
      return { ok: false, message: "Buffer asked us to wait a moment. Try again in a minute." };
    }
    if (APICallError.isInstance(e) || NoObjectGeneratedError.isInstance(e)) {
      await giveBack();
      return { ok: false, message: aiErrorMessage(e, provider) };
    }
    console.error(JSON.stringify({ event: "qp-write-week-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Could not write the drafts just now. Try again." };
  } finally {
    await settle();
  }
}

