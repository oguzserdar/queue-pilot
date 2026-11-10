/** Shared built-in writer for the browser action and authenticated connector. */
import { SourceContextError } from "./source-context";
import { waitMessage, waitRefusal } from "./buffer/not-sent";
import type { Channel, Post } from "./buffer/queries";
import type { Provider } from "./ai-key-store";
import { streamDrafts, writeDrafts, type BriefMaterial } from "./ai-writer";
import type { FillDraftStore } from "./fill-draft-store";
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

/** What a live run reports as it goes. The store is written before each report. */
export type LiveFill = {
  runId: string;
  store: FillDraftStore;
  /** The times this run will write into, soonest first, before any AI is used. */
  onStart?: (slotIds: string[]) => void;
  /** A draft the model finished and our store now holds. A rewrite reports the same time again. */
  onDraft?: (draft: { slotId: string; text: string }) => void;
  /** The Buffer save is starting. */
  onSaving?: () => void;
};

/**
 * Writes and saves drafts for one week's empty times, or for one exact time.
 *
 * @param only - One slot id, to write just that time
 * @param week - Which week to fill when `only` is not given: the following one (default) or the one today is in
 * @param live - When given, each draft is handed over as the model finishes it: recorded in our own store first,
 *   then reported, and the Buffer save at the end is marked on those records. Without it the run answers once.
 */
export async function writeSlotsForUser(loadBuffer: () => Promise<WriteBuffer | null>, only?: string, week: "this" | "next" = "next", live?: LiveFill): Promise<WriteWeekActionResult> {
  let provider: Provider = "anthropic";
  let giveBack = async () => {};
  let settle = async () => {};
  try {
    const b = await loadBuffer();
    if (!b) return { ok: false, message: "Sign in with Buffer first." };
    // Checked before an AI action is taken, so a click with nothing to write costs the person nothing.
    const open = openSlots(b.channels, b.posts, b.range).slots;
    const now = new Date();
    const slots = slotsToWrite(open, now, b.timeZone, only, week);
    if (only && !slots.length) return { ok: false, message: "That time is no longer empty. Refresh the week." };
    if (!slots.length) return { ok: false, message: `No empty times are left ${week === "this" ? "this week" : "next week"}. Sync with Buffer and check the week.` };
    live?.onStart?.(slots.map((x) => x.id));
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
        const withSource = (d: Awaited<ReturnType<typeof writeDrafts>>[number]) => {
          const source = brief.material.find(m => m.key === d.sourceKey);
          if (source?.snapshotId) return { ...d, snapshotId: source.snapshotId };
          invalidSources.set(d.slotId, "The writer did not identify a supplied source. This draft was not saved.");
          return null;
        };
        if (!live) return (await writeDrafts(model, brief)).flatMap(d => withSource(d) ?? []);
        // Our own record first, then the report: a draft the person has seen is one we hold.
        const kept: NonNullable<ReturnType<typeof withSource>>[] = [];
        await streamDrafts(model, brief, async (d) => {
          const draft = withSource(d);
          if (!draft) return;
          await live.store.written(b.userId, live.runId, draft);
          kept.push(draft);
          live.onDraft?.({ slotId: draft.slotId, text: draft.text });
        });
        return kept;
      },
      // The playbook check is part of this one action, so it judges with the same AI instead of taking another.
      save: async (drafts, sourceKeys) => {
        if (live) { await live.store.startCall(b.userId, live.runId, drafts.map(d => d.slotId)); live.onSaving?.(); }
        const result = await saveDraftsForUser(b.userId, b.token, { title: "Written by Queue Pilot", drafts, open: slots, sourceKeys }, { ...ai, judges: { decider: ai.decider, explainer: ai.language } });
        if (live) await live.store.finish(b.userId, live.runId, { saved: result.saved.map(x => ({ slotId: x.slotId, postId: x.postId })), refused: result.refused });
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
    // A model that timed out was billed for nothing usable: the action is given back like any other AI failure.
    if (APICallError.isInstance(e) || NoObjectGeneratedError.isInstance(e) || (e instanceof Error && (e.name === "TimeoutError" || /aborted due to timeout/i.test(e.message)))) {
      await giveBack();
      return { ok: false, message: aiErrorMessage(e, provider) };
    }
    console.error(JSON.stringify({ event: "qp-write-week-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Could not write the drafts just now. Try again." };
  } finally {
    await settle();
  }
}

