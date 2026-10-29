"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { refreshBuffer, type RefreshResult } from "@/app/(app)/actions";
import { RefreshCWIcon } from "./animated-icons/refresh-cw";
import styles from "./buffer-sync.module.css";

/**
 * How fresh the Buffer copy is, shown the stale-while-revalidate way: pages render the saved copy at once and an old
 * copy (over 5 minutes) syncs in the background on load and when the tab comes back. Calm states stay quiet in the
 * sidebar; only a failed sync or a used-up request limit raises the band at the top, because only those need a decision.
 */
const OLD_MS = 5 * 60_000;

export type SyncStatus = Status;
type Status = { kind: "idle" } | { kind: "syncing" } | { kind: "failed" } | { kind: "limited"; retryAt: string };
type Sync = { fetchedAt: string; status: Status; now: number | null; sync: () => void };

const SyncContext = createContext<Sync | null>(null);

export function BufferSyncProvider({ fetchedAt, needsRefresh, preview, children }: {
  fetchedAt: string;
  needsRefresh: boolean;
  /** Development states page only: show this state and never call Buffer. */
  preview?: Status;
  children: ReactNode;
}) {
  const [status, setStatus] = useState<Status>(preview ?? { kind: "idle" });
  const [now, setNow] = useState<number | null>(null);
  const busy = useRef(false);

  const sync = useCallback(() => {
    if (preview || busy.current) return;
    busy.current = true;
    setStatus({ kind: "syncing" });
    refreshBuffer()
      .then((res: RefreshResult) => {
        if (res.ok) setStatus({ kind: "idle" });
        else if (res.kind === "limited") setStatus({ kind: "limited", retryAt: res.retryAt });
        else setStatus({ kind: "failed" });
      })
      .catch(() => setStatus({ kind: "failed" }))
      .finally(() => { busy.current = false; });
  }, [preview]);

  // The clock starts after mount, so server and browser render the same markup.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, [fetchedAt]);

  // An old copy syncs once on load, and again whenever the tab comes back and the copy has aged past 5 minutes.
  useEffect(() => {
    if (needsRefresh) sync();
  }, [needsRefresh, sync]);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - Date.parse(fetchedAt) > OLD_MS) sync();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [fetchedAt, sync]);

  return <SyncContext.Provider value={{ fetchedAt, status, now, sync }}>{children}</SyncContext.Provider>;
}

function useSync(): Sync {
  const value = useContext(SyncContext);
  if (!value) throw new Error("BufferSync parts must sit inside BufferSyncProvider");
  return value;
}

function ago(fetchedAt: string, now: number | null): string {
  if (now === null) return "";
  const mins = Math.max(0, Math.floor((now - Date.parse(fetchedAt)) / 60_000));
  if (mins === 0) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

// Local time in the browser's own format, e.g. "7:30 PM" or "19:30". Only used after mount (server and browser locales differ).
const clock = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** The quiet sidebar line: "Synced 3 min ago" with a refresh button whose icon turns while syncing. */
export function SyncIndicator() {
  const { fetchedAt, status, now, sync } = useSync();
  const syncing = status.kind === "syncing";
  const label = syncing ? "Syncing with Buffer…" : `Synced ${ago(fetchedAt, now)}`;
  return (
    <span className={styles.indicator}>
      <span className={styles.line}>{label}</span>
      <span className="sr-only" aria-live="polite">{syncing ? "Syncing with Buffer" : ""}</span>
      <button
        type="button"
        className={`${styles.iconButton} ${syncing ? styles.spinning : ""}`}
        onClick={sync}
        disabled={syncing || status.kind === "limited"}
        aria-label="Sync with Buffer now"
        title={status.kind === "limited" && now !== null ? `Buffer's request limit resets at ${clock(status.retryAt)}` : "Sync with Buffer now"}
      >
        <RefreshCWIcon size={16} />
      </button>
    </span>
  );
}

/** The top band, shown only when a sync failed or Buffer's limit is used up. */
export function SyncBanner() {
  const { fetchedAt, status, now, sync } = useSync();
  if (now === null || (status.kind !== "failed" && status.kind !== "limited")) return null;
  return (
    <div className={styles.banner} role="status">
      <span>
        {status.kind === "limited"
          ? `Buffer's request limit resets at ${clock(status.retryAt)}. Showing your queue from ${clock(fetchedAt)}.`
          : `Buffer didn't answer. Showing your queue from ${clock(fetchedAt)}.`}
      </span>
      {status.kind === "failed" ? <button type="button" className={styles.retry} onClick={sync}>Try again</button> : null}
    </div>
  );
}
