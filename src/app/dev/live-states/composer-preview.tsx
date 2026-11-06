"use client";

/** The several-accounts composer opened over the app with example accounts; saving changes nothing (dev preview only). */
import { useState } from "react";
import { AccountsComposer } from "@/components/accounts-composer";
import type { ComposerAccount } from "@/app/(app)/accounts-actions";

const ACCOUNTS: ComposerAccount[] = [
  { id: "x", name: "@alexrivera_ai", service: "twitter", limit: 280, limitFrom: "buffer", disconnected: false },
  { id: "li", name: "Alex Rivera", service: "linkedin", limit: 3000, limitFrom: "built-in", disconnected: false },
  { id: "ig", name: "thisweekinai", service: "instagram", limit: 2196, limitFrom: "built-in", disconnected: true },
];

export function ComposerPreview() {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Open the composer</button>
      <AccountsComposer open={open} onClose={() => setOpen(false)} preview={ACCOUNTS} />
    </>
  );
}
