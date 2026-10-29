/**
 * The message a connector tool may show the AI when it fails.
 */

/** What a tool may say about its own failure: our readable messages pass; database and driver errors do not. */
export function toolErrorMessage(e: unknown): string {
  const message = e instanceof Error ? e.message : "";
  const code = (e as { code?: unknown; cause?: { code?: unknown } } | null)?.code ?? (e as { cause?: { code?: unknown } } | null)?.cause?.code;
  const fromDatabase = /failed query|params:|\b(select|insert|update|delete)\b.+\b(from|into|set|where)\b/i.test(message) || (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code));
  if (!message || fromDatabase) return "Queue Pilot hit a problem reading its own data. Nothing in Buffer changed. Try again in a minute.";
  return message;
}
