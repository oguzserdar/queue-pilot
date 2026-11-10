/** Shared built-in writer for the browser action and authenticated connector. */
import { SourceContextError } from "./source-context";
import { waitMessage, waitRefusal } from "./buffer/not-sent";
import type { Channel, Post } from "./buffer/queries";
import type { Provider } from "./ai-key-store";
import { writeDrafts, type BriefMaterial } from "./ai-writer";
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
  | { ok: false; message: string; /** Set when the run stopped for a reason the person can act on. */ reason?: "no-material" | "ai-used-up" };

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
    const materialNotes: string[] = [];
    const invalidSources = new Map<string, string>();
    const r = await writeWeek(slots, now, {
      material: async () => {
        const items = await newMaterial(b.userId);
        // Pending jobs resume next time. Missing captions still allow description-based drafts.
        const material: BriefMaterial[] = [];
        for (const m of items) {
          try {
            const video = !!m.url && isYouTubeVideo(m.url);
            const transcript = video ? await transcriptForUser(b.userId, m.url!) : null;
            if (transcript?.status === "pending") { materialNotes.push(`${m.title}: transcript still processing.`); continue; }
            const text = transcript?.status === "ready" ? transcript.text : m.text;
            const metadata = transcript?.status === "ready"
              ? { kind: "transcript" as const, segments: transcript.segments, captions: transcript.captions, truncated: transcript.truncated }
              : { truncated: m.truncated, ...(video ? { kind: "video-description" as const } : {}) };
            const snapshot = await captureSource(b.userId, { sourceKey: m.key, uri: m.url ?? `urn:qp:${m.key}`, text, title: m.title.slice(0, 200) }, metadata);
            material.push({ ...m, title: video && transcript?.status !== "ready" ? `${m.title} (video description only)` : m.title, text, snapshotId: snapshot.id, ...metadata });
          } catch {
            materialNotes.push(`${m.title}: source could not be prepared. Other available material was used.`);
          }
        }
        return material;
      },
      voice: () => postgresVoiceStore().get(b.userId),
      rules: () => postgresRulesStore().list(b.userId),
      write: async (brief) => {
        const drafts = (await writeDrafts(model, brief)).flatMap(d => {
          const source = brief.material.find(m => m.key === d.sourceKey);
          if (source?.snapshotId) return [{ ...d, snapshotId: source.snapshotId }];
          invalidSources.set(d.slotId, "The writer did not identify a supplied source. This draft was not saved.");
          return [];
        });
        return drafts;
      },
      // The playbook check is part of this one action, so it judges with the same AI instead of taking another.
      save: async (drafts, sourceKeys) => {
        const result = await saveDraftsForUser(b.userId, b.token, { title: "Written by Queue Pilot", drafts, open: slots, sourceKeys }, { ...ai, judges: { decider: ai.decider, explainer: ai.language } });
        const invalid = [...invalidSources].map(([slotId, reason]) => ({ slotId, reason }));
        invalidSources.clear();
        return { ...result, refused: [...result.refused, ...invalid] };
      },
    });
    if (r.kind === "nothing") {
      await giveBack();
      return { ok: false, message: r.reason === "no-slots" ? "No empty times remain in the chosen week." : materialNotes.join(" ") || "Nothing new to write from. Add your newsletter, blog or video feed under Sources, then fill the week again.", ...(r.reason === "no-material" ? { reason: "no-material" as const } : {}) };
    }
    if (!r.saved.length && r.refused.length && r.refused.every(x => x.reason.startsWith("The writer did not identify a supplied source."))) await giveBack();
    const where = (slotId: string) => { const s = r.saved.find((x) => x.slotId === slotId); return s ? `${s.local} · ${s.channel}` : slotId; };
    return {
      ok: true,
      saved: r.saved.map((s) => ({ local: s.local, channel: s.channel })),
      refused: r.refused,
      retried: r.retried,
      flags: r.flags.map((f) => ({ where: where(f.slotId), rule: f.rule, verdict: f.verdict, reason: f.reason })),
      note: [checkNote(r.check), ...materialNotes].filter(Boolean).join(" ") || undefined,
    };
  } catch (e) {
    if (e instanceof SourceContextError) { await giveBack(); return { ok: false, message: e.message }; }
    if (e instanceof AiCapError) return { ok: false, message: e.message, reason: "ai-used-up" };
    if (e instanceof ModelListError) return { ok: false, message: e.message };
    const wait = waitRefusal(e);
    if (wait) {
      await giveBack();
      return { ok: false, message: waitMessage(wait) };
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

