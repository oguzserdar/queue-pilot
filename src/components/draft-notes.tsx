"use client";

/**
 * The team's Buffer notes on the open draft: read when the window opens, and added, edited or deleted here as the
 * person themselves. Edit and Delete appear only on notes Buffer lets this person change; delete asks first.
 * Notes are shown as people wrote them; Queue Pilot never treats them as instructions.
 */
import { useEffect, useState } from "react";
import { addDraftNote, deleteDraftNote, editDraftNote, readDraftNotes, type DraftNote } from "@/app/(app)/note-actions";
import { MAX_NOTE } from "@/lib/buffer/note-limits";
import { Skeleton } from "@/registry/components/skeleton/skeleton";
import { Textarea } from "@/registry/components/textarea/textarea";
import { Button } from "@/registry/components/button/button";
import styles from "./draft-notes.module.css";

type State = { status: "loading" } | { status: "done"; notes: DraftNote[]; more: boolean } | { status: "failed"; message: string };
type Result = { ok: true } | { ok: false; message: string };

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

/** Notes for one post in the person's queue; `preview` shows given notes and changes them locally (preview page only). */
export function DraftNotes({ postId, preview }: { postId: string; preview?: DraftNote[] }) {
  const [state, setState] = useState<State>(preview ? { status: "done", notes: preview, more: false } : { status: "loading" });
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState<"add" | "edit" | "delete" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (preview) return;
    let live = true;
    setState({ status: "loading" });
    readDraftNotes(postId)
      .then((r) => { if (live) setState(r.ok ? { status: "done", notes: r.notes, more: r.more } : { status: "failed", message: r.message }); })
      .catch(() => { if (live) setState({ status: "failed", message: "Buffer did not return the notes. Try again in a minute." }); });
    return () => { live = false; };
  }, [postId, preview]);

  const notes = state.status === "done" ? state.notes : [];
  const setNotes = (next: (n: DraftNote[]) => DraftNote[]) => setState((s) => (s.status === "done" ? { ...s, notes: next(s.notes) } : s));

  async function act(kind: "add" | "edit" | "delete", run: () => Promise<Result>, done: string, apply: () => void) {
    setBusy(kind);
    setMessage(null);
    const r = await run().catch(() => ({ ok: false as const, message: "Buffer did not answer. Try again in a minute." }));
    setBusy(null);
    if (!r.ok) return setMessage({ ok: false, text: r.message });
    apply();
    setMessage({ ok: true, text: done });
  }

  function add() {
    const text = draft.trim();
    let saved: DraftNote | null = null;
    void act("add", async () => {
      if (preview) { saved = { id: `local-${Date.now()}`, author: "You", createdAt: new Date().toISOString(), text, canEdit: true, canDelete: true }; return { ok: true }; }
      const r = await addDraftNote(postId, text);
      if (r.ok) saved = r.note;
      return r;
    }, "Note added. Your team sees it in Buffer.", () => { const s = saved; if (s) setNotes((n) => [s, ...n]); setDraft(""); });
  }

  function saveEdit(id: string, text: string) {
    void act("edit", () => (preview ? Promise.resolve({ ok: true as const }) : editDraftNote(postId, id, text)), "Note changed in Buffer.", () => {
      setNotes((n) => n.map((x) => (x.id === id ? { ...x, text: text.trim() } : x)));
      setEditing(null);
    });
  }

  function remove(id: string) {
    void act("delete", () => (preview ? Promise.resolve({ ok: true as const }) : deleteDraftNote(postId, id)), "Note deleted from Buffer.", () => {
      setNotes((n) => n.filter((x) => x.id !== id));
      setDeleting(null);
    });
  }

  return (
    <section className={styles.notes} aria-labelledby={`notes-${postId}`}>
      <h3 id={`notes-${postId}`} className={styles.h3}>Team notes</h3>
      {state.status === "loading" && <Skeleton label="Loading team notes" lines={2} />}
      {state.status === "failed" && <p className={styles.muted} role="status">{state.message}</p>}
      {state.status === "done" && (
        <>
          {notes.length === 0 && <p className={styles.muted}>No notes on this post in Buffer.</p>}
          {notes.length > 0 && (
            <ul className={styles.list}>
              {notes.map((n) => (
                <li key={n.id} className={styles.note}>
                  <span className={styles.meta}>{n.author ?? "A deleted account"} · <time dateTime={n.createdAt}>{when(n.createdAt)}</time></span>
                  {editing?.id === n.id ? (
                    <div className={styles.compose}>
                      <Textarea label="Note text" value={editing.text} onChange={(e) => setEditing({ id: n.id, text: e.target.value })} rows={2} maxLength={MAX_NOTE} autoFocus />
                      <div className={styles.actions}>
                        <Button size="sm" variant="primary" disabled={busy !== null || !editing.text.trim() || editing.text.trim() === n.text} onClick={() => saveEdit(n.id, editing.text)}>{busy === "edit" ? "Saving…" : "Save"}</Button>
                        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setEditing(null)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <p className={styles.text}>{n.text}</p>
                  )}
                  {deleting === n.id && (
                    <div className={styles.confirm}>
                      <span>Delete this note from Buffer? This cannot be undone.</span>
                      <div className={styles.actions}>
                        <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => remove(n.id)}>{busy === "delete" ? "Deleting…" : "Delete note"}</Button>
                        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setDeleting(null)}>Keep it</Button>
                      </div>
                    </div>
                  )}
                  {editing?.id !== n.id && deleting !== n.id && (n.canEdit || n.canDelete) && (
                    <div className={styles.links}>
                      {n.canEdit && <button type="button" className={styles.link} onClick={() => { setEditing({ id: n.id, text: n.text }); setDeleting(null); setMessage(null); }}>Edit</button>}
                      {n.canDelete && <button type="button" className={styles.link} onClick={() => { setDeleting(n.id); setEditing(null); setMessage(null); }}>Delete</button>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {state.more && <p className={styles.muted}>Older notes are in Buffer.</p>}
          <div className={styles.compose}>
            <Textarea label="Add a note for your team" value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={MAX_NOTE} />
            <div className={styles.row}>
              <span className={styles.muted}>Visible to your team in Buffer.</span>
              <Button size="sm" variant="secondary" disabled={busy !== null || !draft.trim()} onClick={add}>{busy === "add" ? "Adding…" : "Add note"}</Button>
            </div>
          </div>
          {message && <p className={styles.muted} role={message.ok ? "status" : "alert"}>{message.text}</p>}
        </>
      )}
    </section>
  );
}
