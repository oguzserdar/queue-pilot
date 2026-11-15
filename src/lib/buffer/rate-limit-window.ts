/**
 * @fileoverview How a Buffer rate-limit window is keyed when stored. Buffer names each policy after its quota (such as
 * "150-in-15min"), so the name changes when the quota does, and its guide says to match a policy by its window length
 * instead (developers.buffer.com/guides/api-limits.html). A stored key is "<quota>/<window>s".
 */

/** The stored key for a window with this quota and length in seconds. */
export const windowKey = (quota: number, windowSeconds: number) => `${quota}/${windowSeconds}s`;

/** The window length in a stored key, or null for a key saved before windows were keyed by length. */
export function windowOfKey(key: string): number | null {
  const m = key.match(/^\d+\/(\d+)s$/);
  return m ? Number(m[1]) : null;
}

/**
 * The window length in seconds of a policy stored under Buffer's name, such as "600-in-1day" or "150-in-15min", or
 * null when the name does not say. Used only to retire such a row once a reading keyed by length covers its window.
 */
export function lengthOfName(name: string): number | null {
  const m = name.match(/-in-(\d+)(m|min|minutes?|h|hours?|d|days?)$/);
  if (!m) return null;
  const n = Number(m[1]);
  return n * secondsPerUnit(m[2]);
}

/** Seconds in one unit as Buffer's policy names write it: minutes, hours, else days. */
function secondsPerUnit(unit: string): number {
  if (unit.startsWith("m")) return 60;
  if (unit.startsWith("h")) return 3_600;
  return 86_400;
}
