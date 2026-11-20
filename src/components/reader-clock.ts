"use client";

import { useMemo, useSyncExternalStore } from "react";

/** The reader's clock, to the second, so every read within one render gives the same value. */
export const readNow = () => Math.floor(Date.now() / 1000) * 1000;
/** The server cannot know the reader's clock, so it renders nothing time-based and the browser fills it in. */
export const noClockOnServer = () => null;

/**
 * Subscribes to a tick every `everyMs`, so the clock is read again as time passes; without a period it never ticks.
 *
 * @param everyMs - How often to tick, in milliseconds
 * @returns A subscribe function for useSyncExternalStore
 */
export function tickEvery(everyMs?: number) {
  return (onTick: () => void) => {
    if (!everyMs) return () => {};
    const id = setInterval(onTick, everyMs);
    return () => clearInterval(id);
  };
}

/**
 * The reader's current time, read on each render after the page loads; null on the server and while hydrating, so
 * server and browser render the same markup.
 *
 * @param everyMs - Also render again this often, for a label that must move with time ("Synced 3 min ago")
 * @returns Milliseconds since the epoch, or null before the page is running in the browser
 * @example
 * ```tsx
 * const now = useReaderClock(30_000);
 * return <span>{now === null ? "" : ago(fetchedAt, now)}</span>;
 * ```
 */
export function useReaderClock(everyMs?: number): number | null {
  const subscribe = useMemo(() => tickEvery(everyMs), [everyMs]);
  return useSyncExternalStore(subscribe, readNow, noClockOnServer);
}
