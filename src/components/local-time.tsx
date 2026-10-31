"use client";

import { useEffect, useState } from "react";

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
  const [text, setText] = useState("");
  const [exact, setExact] = useState<string | undefined>();
  useEffect(() => {
    if (!iso) { setText(fallback); return; }
    const full = new Date(iso).toLocaleString(undefined, options);
    setText(rel ? relative(iso, Date.now()) ?? full : full);
    setExact(rel ? new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : undefined);
  }, [iso, options, fallback, rel]);
  return <time dateTime={iso ?? undefined} title={exact}>{text}</time>;
}
