/**
 * Waits for an optional read a screen can do without. When it fails, logs which read failed and returns the fallback,
 * so the screen still renders and the failure is not silent.
 *
 * @param read - The read in flight
 * @param fallback - What the screen uses instead
 * @param name - A short name for the read in the log, such as "week-written"
 * @returns The read's value, or the fallback
 */
export async function readOr<T>(read: Promise<T>, fallback: T, name: string): Promise<T> {
  try {
    return await read;
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-screen-read-failed", read: name, message: e instanceof Error ? e.message : String(e) }));
    return fallback;
  }
}
