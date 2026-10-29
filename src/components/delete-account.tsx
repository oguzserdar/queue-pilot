"use client";

import { useState, useTransition } from "react";
import { deleteMyAccount } from "@/app/(app)/actions";
import { Button } from "@/registry/components/button/button";
import { Input } from "@/registry/components/input/input";
import styles from "./settings-view.module.css";

/** Deletes the person's Queue Pilot account after they type "delete". Buffer is never touched. */
export function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ready = word.trim().toLowerCase() === "delete";

  if (!open) {
    return (
      <div className={styles.deviceActions}>
        <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>Delete my Queue Pilot account</Button>
      </div>
    );
  }
  return (
    <form
      className={styles.deleteForm}
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const r = await deleteMyAccount(word);
          if (!r.ok) return setError(r.message ?? "Something went wrong.");
          try {
            const keep = ["theme", "cookie_consent"].map((k) => [k, localStorage.getItem(k)] as const);
            localStorage.clear();
            sessionStorage.clear();
            for (const [k, v] of keep) if (v !== null) localStorage.setItem(k, v);
          } catch {
            // Storage can be unavailable; the account is already gone.
          }
          window.location.assign("/");
        });
      }}
    >
      <Input label='Type "delete" to confirm' value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" error={error ?? undefined} />
      <div className={styles.deleteActions}>
        <Button type="submit" variant="danger" size="sm" disabled={!ready || pending}>{pending ? "Deleting…" : "Delete account"}</Button>
        <Button type="button" variant="ghost" size="sm" disabled={pending} onClick={() => { setOpen(false); setWord(""); setError(null); }}>Cancel</Button>
      </div>
    </form>
  );
}
