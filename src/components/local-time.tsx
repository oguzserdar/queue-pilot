"use client";

import { useReaderClock } from "./reader-clock";

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [["minute", 60], ["hour", 3600], ["day", 86400]];

/** "5 minutes ago", "3 hours ago", "2 days ago"; past a week, the date itself. */
function relative(iso: string, now: number): string | null {
  const s = Math.round((Date.parse(iso) - now) / 1000);
  if (Math.abs(s) < 45) return "just now";
  if (Math.abs(s) > 7 * 86400) return null;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  const [unit, size] = [...UNITS].reverse().find(([, n]) => Math.abs(s) >= n) ?? UNITS[0];
  return rtf.format(Math.round(s / size), unit);
}

/**
 * A date in the reader's own language and time zone. The server can't know either, so the text is filled in after
 * the page loads; before that the slot is empty rather than wrong. `relative` shows "3 hours ago" with the exact time
 * on hover, falling back to the date after a week.
 */
export function LocalTime({ iso, options, fallback = "", relative: rel = false }: { iso: string | null; options: Intl.DateTimeFormatOptions; fallback?: string; relative?: boolean }) {
  const now = useReaderClock();
  if (now === null) return <time dateTime={iso ?? undefined} />;
  if (!iso) return <time>{fallback}</time>;
  const full = new Date(iso).toLocaleString(undefined, options);
  const exact = rel ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : undefined;
  return <time dateTime={iso} title={exact}>{rel ? relative(iso, now) ?? full : full}</time>;
}
