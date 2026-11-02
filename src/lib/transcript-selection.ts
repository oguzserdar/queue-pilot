import type { SourceSnapshot } from "./source-store";

/** A requested time range changes only the tool response, never the stored source.
 * Boundaries select captions by their start timestamp. No duration is guessed.
 */
export function transcriptSelection(snapshot: SourceSnapshot, startSeconds?: number, endSeconds?: number) {
  if (startSeconds !== undefined && (!Number.isFinite(startSeconds) || startSeconds < 0)) throw new Error("Use a non-negative start time.");
  if (endSeconds !== undefined && (!Number.isFinite(endSeconds) || endSeconds <= (startSeconds ?? 0))) throw new Error("The end time must be after the start time.");
  const all = snapshot.metadata.segments ?? [];
  const selected = startSeconds !== undefined || endSeconds !== undefined;
  if (selected && !all.length) throw new Error("This transcript has no timestamps. Read the full text instead.");
  const segments = selected ? all.filter(s => s.seconds >= (startSeconds ?? 0) && (endSeconds === undefined || s.seconds < endSeconds)) : all;
  return { status: "ready", snapshotId: snapshot.id, sourceKey: snapshot.sourceKey, text: selected ? segments.map(s => s.text).join(" ") : snapshot.text, segments,
    captions: snapshot.metadata.captions ?? "unknown", truncated: !!snapshot.metadata.truncated || selected,
    coverage: { fullTranscriptSaved: !snapshot.metadata.truncated, fullCharacters: snapshot.text.length, lastCaptionSeconds: all.at(-1)?.seconds ?? null,
      selection: selected ? { startSeconds: startSeconds ?? 0, endSeconds: endSeconds ?? null } : null },
    instruction: "Use this snapshotId for draft evidence. A time selection is not a full source version. The last caption timestamp is not a measured episode duration." };
}
