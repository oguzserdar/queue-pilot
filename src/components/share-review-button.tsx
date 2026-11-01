"use client";

import { useEffect, useState, useTransition } from "react";
import { shareForReview } from "@/app/(app)/review-actions";
import { Button } from "@/registry/components/button/button";
import { Checkbox } from "@/registry/components/checkbox/checkbox";
import { CopyButton } from "@/registry/components/copy-button/copy-button";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import SegmentedControl from "@/registry/components/segmented-control/segmented-control";
import styles from "./week-view.module.css";

/** A draft the person can share, with the words that name it in the list. */
/** `label` names the draft for screen readers; `when` is the short time shown on its row. */
export type ShareableDraft = { id: string; label: string; when: string; text: string };

/**
 * Share for review: the person ticks the drafts to share and gets one link. Anyone with it can read and comment on
 * those drafts, nothing else. The link is turned off on the Reviews page.
 */
export function ShareReviewButton({ drafts, openSignal = 0 }: { drafts: ShareableDraft[]; openSignal?: number }) {
  const [days, setDays] = useState(7);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const show = () => { setPicked(new Set(drafts.slice(0, 30).map((d) => d.id))); setUrl(null); setMessage(null); setOpen(true); };
  // A palette action opens the dialog without a click.
  useEffect(() => { if (openSignal) show(); }, [openSignal]); // eslint-disable-line react-hooks/exhaustive-deps
  const toggle = (id: string, on: boolean) => setPicked((s) => { const n = new Set(s); if (on && n.size < 30) n.add(id); else n.delete(id); return n; });
  const share = () => start(async () => {
    const r = await shareForReview([...picked], days);
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
              <p className={styles.shareNote}>{`Works for ${days} day${days === 1 ? "" : "s"}. Comments show up on Reviews, where each one can become proposed edits.`}</p>
              <div className={styles.shareActions}>
                <CopyButton value={url} label="Copy link" />
                <Button variant="ghost" onClick={() => setOpen(false)}>Done</Button>
              </div>
            </div>
          ) : (
            <div className={styles.shareBody}>
              <div className={styles.shareHead}>
                <span className={styles.shareCount}>{`${picked.size} of ${drafts.length} drafts`}</span>
                <Button variant="ghost" size="sm" onClick={() => setPicked(picked.size === Math.min(drafts.length, 30) ? new Set() : new Set(drafts.slice(0, 30).map((d) => d.id)))}>{picked.size === Math.min(drafts.length, 30) ? "Clear" : "Select all"}</Button>
              </div>
              <ul className={styles.shareList}>
                {drafts.map((d) => (
                  // One line per draft, so ten drafts fit without scrolling; the full text is in the title.
                  <li key={d.id} className={styles.shareRow}>
                    <Checkbox id={`share-${d.id}`} aria-label={d.label} checked={picked.has(d.id)} onCheckedChange={(v) => toggle(d.id, v === true)} />
                    <label htmlFor={`share-${d.id}`} className={styles.shareLine} title={d.text}><b>{d.when}</b> {d.text}</label>
                  </li>
                ))}
              </ul>
              <div className={styles.shareExpiry}>
                <span className={styles.shareCount}>Link works for</span>
                <SegmentedControl label="Link works for" options={[{ value: "1", label: "1 day" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }]} value={String(days)} onValueChange={(v) => setDays(Number(v))} />
              </div>
              <p className={styles.shareNote}>Reviewers see only the drafts you tick. Turn the link off any time on Reviews.</p>
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
