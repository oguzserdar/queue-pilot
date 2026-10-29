"use client";

import { SignInButton } from "./sign-in-button";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSlotDraft, writeSlotDraft } from "@/app/(app)/actions";
import { countFor, limitFor } from "@/lib/char-limits";
import { Button } from "@/registry/components/button/button";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { Textarea } from "@/registry/components/textarea/textarea";
import { formatShortcut, Kbd, usePlatform } from "@/registry/components/shortcut-recorder/shortcut-recorder";
import styles from "./week-view.module.css";

/** The empty slot being written into: its id (absent in example mode), how the week names it, and its network. */
export type ComposerSlot = { id?: string; name: string; service?: string };

/**
 * Clicking an empty slot opens a composer for that channel and time: write the post yourself, or let your AI write it
 * from your new material. Both save a Buffer draft through the same playbook check as every save. The text box takes
 * focus on open, counts characters against the channel's limit as you type, saves on Cmd/Ctrl+Enter, and asks before
 * throwing away typed text.
 */
export function SlotComposer({ slot, live, onClose }: { slot: ComposerSlot | null; live: boolean; onClose: (saved?: string) => void }) {
  const [text, setText] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [busy, start] = useTransition();
  const [doing, setDoing] = useState<"save" | "write" | null>(null);
  const router = useRouter();
  const platform = usePlatform();
  const canSave = live && slot?.id !== undefined;
  const limit = slot?.service ? limitFor(slot.service) : null;
  const used = slot?.service ? countFor(slot.service, text) : text.length;
  const over = limit !== null && used > limit;

  const reset = () => { setText(""); setProblem(null); setConfirmDiscard(false); };
  const close = () => { reset(); onClose(); };
  const finish = (r: { ok: true; title?: string } | { ok: false; message: string }, done: string) => {
    if (!r.ok) return setProblem(r.message);
    reset();
    router.refresh();
    onClose(r.title ? `${done} ${r.title}` : done);
  };
  const save = () => {
    if (!canSave || busy || !text.trim() || over) return;
    setDoing("save");
    start(async () => finish(await saveSlotDraft(slot!.id!, text), "Draft saved."));
  };

  return (
    <Dialog open={slot !== null} onOpenChange={(o) => { if (o) return; if (text.trim() && !busy) setConfirmDiscard(true); else close(); }}>
      {slot && (
        <DialogContent className={styles.dialog} title={`New post: ${slot.name}`} description={canSave ? "Saved as a Buffer draft for you to approve." : "This is the example account. Sign in with Buffer to write into your own empty slots, yourself or with your AI."}>
          <div className={styles.composer}>
            {!canSave ? (
              <div className={styles.composerActions}>
                <SignInButton variant="primary" size="md" />
              </div>
            ) : confirmDiscard ? (
              <>
                <p className={styles.problem} role="alert">Throw away this post? It is not saved anywhere.</p>
                <div className={styles.composerActions}>
                  <Button variant="secondary" autoFocus onClick={() => setConfirmDiscard(false)}>Keep writing</Button>
                  <Button variant="danger" onClick={close}>Discard</Button>
                </div>
              </>
            ) : (
              <>
                <Textarea
                  label="Post"
                  autoFocus
                  value={text}
                  rows={6}
                  onChange={(e) => { setText(e.target.value); setProblem(null); }}
                  onKeyDown={(e) => { if ((e.key === "Enter" || e.key === "s") && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } }}
                />
                <div className={styles.composerFoot}>
                  <span><Kbd size="sm">{formatShortcut("mod+enter", platform).text}</Kbd> saves</span>
                  {limit !== null && <span className={`tnum ${over ? styles.over : ""}`} aria-live="polite">{used.toLocaleString("en-GB")} / {limit.toLocaleString("en-GB")}</span>}
                </div>
                {over && <p className={styles.problem} role="alert">Too long for this channel by {(used - limit!).toLocaleString("en-GB")} characters.</p>}
                {problem && <p className={styles.problem} role="alert">{problem}</p>}
                <div className={styles.composerActions}>
                  <Button variant="primary" disabled={busy || !text.trim() || over} onClick={save}>
                    {busy && doing === "save" ? "Saving…" : "Save draft"}
                  </Button>
                  <Button variant="secondary" disabled={busy} onClick={() => { setDoing("write"); start(async () => {
                    const r = await writeSlotDraft(slot.id!);
                    // Nothing saved is a problem to read here, with the reasons, not a success that closes the dialog.
                    if (r.ok && !r.saved.length) return setProblem(["Nothing was saved.", ...r.refused.map((x) => x.reason), r.note].filter(Boolean).join(" "));
                    finish(r.ok ? { ok: true, title: r.flags[0] ? `Check: ${r.flags[0].rule}.` : r.note } : r, "Your AI wrote a draft.");
                  }); }}>
                    {busy && doing === "write" ? "Writing… this takes up to a minute" : "Write it with my AI"}
                  </Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
