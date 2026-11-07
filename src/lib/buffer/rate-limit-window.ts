/**
 * @fileoverview How a Buffer rate-limit window is keyed when stored. Buffer names each policy after its quota (such as
 * "150-in-15min"), so the name changes when the quota does, and its guide says to match a policy by its window length
 * instead (developers.buffer.com/guides/api-limits). A stored key is "<quota>/<window>s".
 */

/** The stored key for a window with this quota and length in seconds. */
export const windowKey = (quota: number, windowSeconds: number) => `${quota}/${windowSeconds}s`;

/** The window length in a stored key, or null for a key saved before windows were keyed by length. */
export function windowOfKey(key: string): number | null {
  const m = key.match(/^\d+\/(\d+)s$/);
  return m ? Number(m[1]) : null;
}
