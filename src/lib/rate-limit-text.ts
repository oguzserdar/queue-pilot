/** Plain-language text for Buffer RateLimit policy names such as "250-in-24h". */
/** "250-in-24h" → "250", "15100-in-30days" → "15,100". */
export const quotaOf = (policy: string) => {
  const n = policy.match(/^\d+/)?.[0];
  return n ? Number(n).toLocaleString("en-US") : "?";
};
/** "250-in-24h" → "24 hours", "525-in-1day" → "day"; unknown windows are shown as Buffer names them. */
export function windowOf(policy: string): string {
  const w = policy.split("-in-")[1] ?? policy;
  // Buffer's docs use short units (15min, 24h, 30d); the live headers spell them out (1day, 30days).
  const m = w.match(/^(\d+)(min|minutes?|h|hours?|d|days?)$/);
  if (!m) return w;
  const unit = m[2].startsWith("min") ? "minute" : m[2].startsWith("h") ? "hour" : "day";
  // "per day" reads better than "per 1 day".
  return m[1] === "1" ? unit : `${m[1]} ${unit}s`;
}
