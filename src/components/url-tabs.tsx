"use client";

import { useState, type ReactNode } from "react";
import { Tabs } from "@/registry/components/tabs/tabs";

/**
 * Tabs whose open tab lives in the address (?tab=…), so a reload or a shared link opens the same one. Switching
 * replaces the address instead of adding to history, so the back button still leaves the page.
 */
export function UrlTabs({ initial, first, children }: { initial: string; first: string; children: ReactNode }) {
  const [open, setOpen] = useState(initial);
  const choose = (v: string) => {
    setOpen(v);
    const url = new URL(window.location.href);
    if (v === first) url.searchParams.delete("tab"); else url.searchParams.set("tab", v);
    // A tab change also clears one-time notices like ?saved=, which belong to the tab they were shown on.
    for (const k of ["saved", "cleared", "error", "field", "problem", "openrouter"]) url.searchParams.delete(k);
    window.history.replaceState(null, "", url);
  };
  return <Tabs value={open} onValueChange={choose}>{children}</Tabs>;
}
