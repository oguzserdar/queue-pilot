"use client";

import { useEffect, useState } from "react";

/**
 * A date in the reader's own language and time zone. The server can't know either, so the text is filled in after
 * the page loads; before that the slot is empty rather than wrong.
 */
export function LocalTime({ iso, options, fallback = "" }: { iso: string | null; options: Intl.DateTimeFormatOptions; fallback?: string }) {
  const [text, setText] = useState("");
  useEffect(() => { setText(iso ? new Date(iso).toLocaleString(undefined, options) : fallback); }, [iso, options, fallback]);
  return <time dateTime={iso ?? undefined}>{text}</time>;
}
