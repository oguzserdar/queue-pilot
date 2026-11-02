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
import { isYouTubeVideo } from "./transcripts";
import { transcriptForUser } from "./transcript-for-user";
import { captureSource } from "./source-store";
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
    const r = await writeWeek(slots, now, {
      material: async () => {
        const items = await newMaterial(b.userId);
        // A YouTube item carries only its description; with a Supadata key the transcript is added.
        const material = [];
        for (const m of items) {
          const transcript = m.url && isYouTubeVideo(m.url) ? await transcriptForUser(b.userId, m.url) : null;
          // A pending long-video job remains unused; the next write resumes it.
          if (transcript && transcript.status !== "ready") continue;
          const text = transcript?.status === "ready" ? transcript.text : m.text;
          const metadata = transcript?.status === "ready" ? { segments: transcript.segments, captions: transcript.captions, truncated: transcript.truncated } : { truncated: m.truncated };
          const snapshot = await captureSource(b.userId, { sourceKey: m.key, uri: m.url ?? `urn:qp:${m.key}`, text, title: m.title.slice(0, 200) }, metadata);
          material.push({ ...m, text, snapshotId: snapshot.id, ...metadata });
        }
        return material;
      },
      voice: () => postgresVoiceStore().get(b.userId),
      rules: () => postgresRulesStore().list(b.userId),
      write: async (brief) => {
        const drafts = (await writeDrafts(model, brief)).flatMap(d => {
          const source = brief.material.find(m => m.key === d.sourceKey);
          return source?.snapshotId ? [{ ...d, snapshotId: source.snapshotId }] : [];
        });
        if (!drafts.length) throw new Error("The writer returned no drafts tied to a supplied source.");
        return drafts;
      },
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

