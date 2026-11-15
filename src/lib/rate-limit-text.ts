/**
 * Plain-language text for Buffer RateLimit windows: Buffer's own names such as "250-in-24h", and windows stored by
 * their length as "<quota>/<seconds>s" (src/lib/buffer/rate-limit-window.ts).
 */
const keyed = (policy: string) => policy.match(/^(\d+)\/(\d+)s$/);

/** "250-in-24h" → "250", "15100-in-30days" → "15,100", "120/900s" → "120". */
export const quotaOf = (policy: string) => {
  const n = keyed(policy)?.[1] ?? policy.match(/^(\d+)-in-/)?.[1];
  return n ? Number(n).toLocaleString("en-US") : "?";
};

/** A window length in seconds in words: 900 → "15 minutes", 86400 → "day", 2592000 → "30 days". */
function lengthInWords(seconds: number): string {
  const [n, unit] = lengthAndUnit(seconds);
  return n === 1 ? unit : `${n} ${unit}s`;
}

/** The largest whole unit a window length fits: days, then hours, else rounded minutes. */
function lengthAndUnit(seconds: number): [number, string] {
  if (seconds % 86_400 === 0) return [seconds / 86_400, "day"];
  if (seconds % 3_600 === 0) return [seconds / 3_600, "hour"];
  return [Math.round(seconds / 60), "minute"];
}
/** "250-in-24h" → "24 hours", "525-in-1day" → "day"; unknown windows are shown as Buffer names them. */
export function windowOf(policy: string): string {
  const k = keyed(policy);
  if (k) return lengthInWords(Number(k[2]));
  const w = policy.split("-in-")[1] ?? policy;
  // Buffer's docs use short units (15min, 24h, 30d); the live headers spell them out (1day, 30days).
  const m = w.match(/^(\d+)(m|min|minutes?|h|hours?|d|days?)$/);
  if (!m) return w;
  const unit = unitOf(m[2]);
  // "per day" reads better than "per 1 day".
  return m[1] === "1" ? unit : `${m[1]} ${unit}s`;
}

/** Buffer's unit spelling as a word: m, min, minutes → minute; h, hours → hour; d, days → day. */
function unitOf(short: string): string {
  if (short.startsWith("m")) return "minute";
  if (short.startsWith("h")) return "hour";
  return "day";
}

/** A window-only policy does not state a total allowance. Never turn its duration into a quota. */
export function remainingOf(policy: string, remaining: number): string {
  const quota = quotaOf(policy);
  return `${remaining.toLocaleString("en-US")}${quota === "?" ? " remaining" : ` of ${quota}`} per ${windowOf(policy)}`;
}
