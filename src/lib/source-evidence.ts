import { createHash } from "node:crypto";
import { z } from "zod";

export const SOURCE_TEXT_LIMIT = 20_000;
export const normalizeSource = (text: string) => text.replace(/\s+/gu, " ").trim();
export const sourceHash = (text: string) => createHash("sha256").update(normalizeSource(text)).digest("hex");
export const webUri = z.string().url().max(2000).refine(v => ["https:", "http:"].includes(new URL(v).protocol) && !new URL(v).username && !new URL(v).password, "Use a public web address.");
export const sourceVersionInput = z.object({
  sourceKey: z.string().trim().min(1).max(2000), uri: z.union([webUri, z.string().regex(/^urn:qp:material:[a-f0-9]{64}$/)]),
  text: z.string().max(SOURCE_TEXT_LIMIT).transform(normalizeSource).pipe(z.string().min(1)),
  title: z.string().trim().max(200).optional(),
});
export const evidenceInput = z.object({
  claim: z.string().trim().min(1).max(500), quote: z.string().trim().min(1).max(500),
  locator: z.string().regex(/^t=\d+$/).optional(),
});
export type EvidenceInput = z.infer<typeof evidenceInput>;
export type SourceMetadata = { segments?: { text: string; seconds: number }[]; captions?: "auto" | "manual" | "unknown"; paidPreview?: boolean; truncated?: boolean; etag?: string; lastModified?: string };

/** A caller cannot make a quote or timestamp verified merely by supplying it. */
export function verifyEvidence(draft: string, source: string, input: EvidenceInput, metadata: SourceMetadata = {}) {
  input = evidenceInput.parse(input);
  const claim = normalizeSource(input.claim);
  if (!normalizeSource(draft).includes(claim)) throw new Error("The evidence claim must appear in the draft.");
  const quote = normalizeSource(input.quote);
  const found = normalizeSource(source).includes(quote);
  const seconds = input.locator ? Number(input.locator.slice(2)) : null;
  const segment = seconds === null ? undefined : metadata.segments?.find(s => Math.floor(s.seconds) === seconds && normalizeSource(s.text).includes(quote));
  return { claim, quote: found ? quote : null, locator: found && segment ? `t=${seconds}` : null };
}
