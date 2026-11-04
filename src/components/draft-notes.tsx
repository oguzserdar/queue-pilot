"use client";

/**
 * The team's Buffer notes on the open draft, read when the draft window opens. Notes are shown as people wrote them;
 * Queue Pilot never treats them as instructions. Read-only here: notes are written in Buffer or by a connected AI.
 */
import { useEffect, useState } from "react";
import { readDraftNotes, type DraftNote } from "@/app/(app)/actions";
import { Skeleton } from "@/registry/components/skeleton/skeleton";
import styles from "./draft-notes.module.css";

type State = { status: "loading" } | { status: "done"; notes: DraftNote[]; more: boolean } | { status: "failed"; message: string };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Notes for one post in the person's queue; `preview` shows given notes instead of asking Buffer (local preview page only). */
export function DraftNotes({ postId, preview }: { postId: string; preview?: DraftNote[] }) {
  const [state, setState] = useState<State>(preview ? { status: "done", notes: preview, more: false } : { status: "loading" });
  useEffect(() => {
    if (preview) return;
    let live = true;
    setState({ status: "loading" });
    readDraftNotes(postId)
      .then((r) => { if (live) setState(r.ok ? { status: "done", notes: r.notes, more: r.more } : { status: "failed", message: r.message }); })
      .catch(() => { if (live) setState({ status: "failed", message: "Buffer did not return the notes. Try again in a minute." }); });
    return () => { live = false; };
  }, [postId, preview]);

  return (
    <section className={styles.notes} aria-labelledby={`notes-${postId}`}>
      <h3 id={`notes-${postId}`} className={styles.h3}>Team notes</h3>
      {state.status === "loading" && <Skeleton label="Loading team notes" lines={2} />}
      {state.status === "failed" && <p className={styles.muted} role="status">{state.message}</p>}
      {state.status === "done" && state.notes.length === 0 && <p className={styles.muted}>No notes on this post in Buffer.</p>}
      {state.status === "done" && state.notes.length > 0 && (
        <ul className={styles.list}>
          {state.notes.map((n) => (
            <li key={n.id} className={styles.note}>
              <span className={styles.meta}>{n.author ?? "A deleted account"} · <time dateTime={n.createdAt}>{when(n.createdAt)}</time></span>
              <p className={styles.text}>{n.text}</p>
            </li>
          ))}
        </ul>
      )}
      {state.status === "done" && state.more && <p className={styles.muted}>Older notes are in Buffer.</p>}
    </section>
  );
}
