import { createHash } from "node:crypto";
import { z } from "zod";

export const normalizeSource = (text: string) => text.replace(/\s+/gu, " ").trim();
export const sourceHash = (text: string) => createHash("sha256").update(normalizeSource(text)).digest("hex");
export const webUri = z.string().url().max(2000).refine(v => ["https:", "http:"].includes(new URL(v).protocol) && !new URL(v).username && !new URL(v).password, "Use a public web address.");
export const sourceVersionInput = z.object({
  sourceKey: z.string().trim().min(1).max(2000), uri: z.union([webUri, z.string().regex(/^urn:qp:material:[a-f0-9]{64}$/)]),
  text: z.string().transform(normalizeSource).pipe(z.string().min(1)),
  title: z.string().trim().max(200).optional(),
});
export const evidenceInput = z.object({
  claim: z.string().trim().min(1).max(500).describe("Copy the exact sentence or phrase from the draft text, word for word. Do not paraphrase or summarize it. Whitespace differences are allowed."),
  quote: z.string().trim().min(1).max(500).describe("Copy a supporting passage word for word from the saved source snapshot. Do not paraphrase it."),
  // Models often write "" for "no timestamp"; an empty value means none and must not void the whole answer.
  locator: z.string().regex(/^(t=\d+)?$/).optional().describe("Optional timestamp from the returned transcript segments, e.g. t=7190. Never invent a timestamp."),
});
export type EvidenceInput = z.infer<typeof evidenceInput>;

/**
 * What an AI is told about a draft it saved that cites nothing saved in Queue Pilot. Such a draft may be fine ("we are
 * closed on Friday"), so it is saved; the words ask the person to check where it came from, because a draft with no
 * source is also what a post written from someone's inbox looks like.
 */
export const NO_SOURCE_REASON = "No source. This draft cites nothing saved in Queue Pilot. Check where it came from before approving.";
export type SourceMetadata = { kind?: "transcript" | "video-description"; excerptWindow?: "prefix-12000"; segments?: { text: string; seconds: number }[]; captions?: "auto" | "manual" | "unknown"; paidPreview?: boolean; truncated?: boolean; etag?: string; lastModified?: string };

export function evidenceProblem(draft: string, source: string, input: EvidenceInput, metadata: SourceMetadata = {}): string | null {
  const checked = verifyEvidence(draft, source, input, metadata);
  if (!normalizeSource(draft).includes(checked.claim)) return "The evidence claim is not in the draft. Copy the exact draft sentence or phrase into claim; do not paraphrase it.";
  if (!checked.quote) return "The evidence quote is not in the saved source. Copy a supporting passage word for word from that snapshot.";
  if (input.locator && !checked.locator) return "The timestamp does not match the quoted captions. Use the returned segment timestamp or omit locator.";
  return null;
}

/** A caller cannot make a quote or timestamp verified merely by supplying it. */
export function verifyEvidence(draft: string, source: string, input: EvidenceInput, metadata: SourceMetadata = {}) {
  input = evidenceInput.parse(input);
  const claim = normalizeSource(input.claim);
  const claimFound = normalizeSource(draft).includes(claim);
  const quote = normalizeSource(input.quote);
  const found = claimFound && normalizeSource(source).includes(quote);
  const seconds = input.locator ? Number(input.locator.slice(2)) : null;
  // Captions often split one sentence across several segments. The quote must START
  // in the caption at this timestamp, but may continue through following captions.
  const segments = metadata.segments ?? [];
  const segment = seconds === null ? undefined : segments.find((s, i) => {
    if (Math.floor(s.seconds) !== seconds) return false;
    const first = normalizeSource(s.text);
    let passage = first;
    for (let j = i + 1; j < segments.length && passage.length < first.length + quote.length; j++) passage += ` ${normalizeSource(segments[j].text)}`;
    const at = passage.indexOf(quote);
    return at >= 0 && at < first.length;
  });
  return { claim, quote: found ? quote : null, locator: found && segment ? `t=${seconds}` : null };
}
