"use client";

import { useState, useTransition } from "react";
import { shareForReview } from "@/app/(app)/review-actions";
import { Button } from "@/registry/components/button/button";
import { Checkbox } from "@/registry/components/checkbox/checkbox";
import { CopyButton } from "@/registry/components/copy-button/copy-button";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import styles from "./week-view.module.css";

/** A draft the person can share, with the words that name it in the list. */
export type ShareableDraft = { id: string; label: string; text: string };

/**
 * Share for review: the person ticks the drafts to share and gets one link. Anyone with it can read and comment on
 * those drafts, nothing else. The link is turned off on the Reviews page.
 */
export function ShareReviewButton({ drafts }: { drafts: ShareableDraft[] }) {
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const show = () => { setPicked(new Set(drafts.map((d) => d.id))); setUrl(null); setMessage(null); setOpen(true); };
  const toggle = (id: string, on: boolean) => setPicked((s) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; });
  const share = () => start(async () => {
    const r = await shareForReview([...picked]);
    if (r.ok) setUrl(`${window.location.origin}/r/${r.id}`); else setMessage(r.message);
  });

  return (
    <>
      <Button variant="secondary" size="lg" onClick={show}>Share for review</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title={url ? "Review link ready" : "Share drafts for review"} description={url ? "Anyone with this link can read these drafts and comment. Turn it off on the Reviews page." : "No account needed to comment. Comments can become rules you keep. Nothing is posted."}>
          {url ? (
            <div className={styles.shareBody}>
              <p className={styles.shareUrl}>{url}</p>
              <div className={styles.shareActions}>
                <CopyButton value={url} label="Copy link" />
                <Button variant="ghost" onClick={() => setOpen(false)}>Done</Button>
              </div>
            </div>
          ) : (
            <div className={styles.shareBody}>
              <ul className={styles.shareList}>
                {drafts.map((d) => (
                  <li key={d.id}>
                    <Checkbox checked={picked.has(d.id)} onCheckedChange={(v) => toggle(d.id, v === true)} label={d.label} description={d.text.length > 120 ? `${d.text.slice(0, 120)}…` : d.text} />
                  </li>
                ))}
              </ul>
              {message && <p className={styles.shareError} role="alert">{message}</p>}
              <div className={styles.shareActions}>
                <Button variant="ghost" onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
                <Button variant="primary" onClick={share} disabled={pending || picked.size === 0}>{pending ? "Sharing…" : `Share ${picked.size} draft${picked.size === 1 ? "" : "s"}`}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
