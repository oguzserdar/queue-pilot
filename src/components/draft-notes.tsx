"use client";

/**
 * Buffer's Notes on the open draft, laid out like Buffer's own Notes panel: a short thread (picture or initials, name,
 * time, "edited"), Edit and Delete on hover for notes Buffer lets this person change, and one "Add a note" box with a
 * send button (Cmd/Ctrl+Enter). Worded by account: a solo Buffer account leaves notes for itself; a team account is
 * told who can see them. Every note lives in Buffer; Queue Pilot keeps none and never treats one as an instruction.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { ArrowUp, Info, Pencil, StickyNote, Trash2 } from "lucide-react";
import { addDraftNote, deleteDraftNote, editDraftNote, readDraftNotes, type DraftNote } from "@/app/(app)/note-actions";
import { MAX_NOTE } from "@/lib/buffer/note-limits";
import { Avatar } from "@/registry/components/avatar/avatar";
import { Skeleton } from "@/registry/components/skeleton/skeleton";
import { Button } from "@/registry/components/button/button";
import { Tooltip } from "@/registry/components/tooltip/tooltip";
import styles from "./draft-notes.module.css";

type Loaded = { notes: DraftNote[]; more: boolean; team: boolean };
type State = { status: "loading" } | ({ status: "done" } & Loaded) | { status: "failed"; message: string };
type Result = { ok: true } | { ok: false; message: string };

/** "just now", "12 min ago", "3:40 PM" today, else "4 Nov". */
function when(iso: string, now = Date.now()): string {
  const t = new Date(iso);
  const mins = Math.round((now - t.getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (new Date(now).toDateString() === t.toDateString()) return t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return t.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

/** Grows a textarea with its text, up to the CSS max-height. */
const grow = (el: HTMLTextAreaElement | null) => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } };

/** Notes for one post in the person's queue; `preview` shows given notes and changes them locally (preview page only). */
export function DraftNotes({ postId, preview }: { postId: string; preview?: Loaded }) {
  const [state, setState] = useState<State>(preview ? { status: "done", ...preview } : { status: "loading" });
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState<"add" | "edit" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (preview) return;
    let live = true;
    setState({ status: "loading" });
    readDraftNotes(postId)
      .then((r) => { if (live) setState(r.ok ? { status: "done", notes: r.notes, more: r.more, team: r.team } : { status: "failed", message: r.message }); })
      .catch(() => { if (live) setState({ status: "failed", message: "Buffer did not return the notes. Try again in a minute." }); });
    return () => { live = false; };
  }, [postId, preview]);

  const setNotes = (next: (n: DraftNote[]) => DraftNote[]) => setState((s) => (s.status === "done" ? { ...s, notes: next(s.notes) } : s));

  async function act(kind: "add" | "edit" | "delete", run: () => Promise<Result>, apply: () => void) {
    setBusy(kind);
    setError(null);
    const r = await run().catch(() => ({ ok: false as const, message: "Buffer did not answer. Try again in a minute." }));
    setBusy(null);
    if (r.ok) apply(); else setError(r.message);
  }

  function add() {
    const text = draft.trim();
    if (!text || busy) return;
    let saved: DraftNote | null = null;
    void act("add", async () => {
      if (preview) { saved = { id: `local-${Date.now()}`, author: "You", avatar: null, createdAt: new Date().toISOString(), edited: false, text, canEdit: true, canDelete: true }; return { ok: true }; }
      const r = await addDraftNote(postId, text);
      if (r.ok) saved = r.note;
      return r;
    }, () => { const s = saved; if (s) setNotes((n) => [s, ...n]); setDraft(""); requestAnimationFrame(() => grow(composer.current)); });
  }

  function saveEdit(id: string, text: string) {
    if (!text.trim() || busy) return;
    void act("edit", () => (preview ? Promise.resolve({ ok: true as const }) : editDraftNote(postId, id, text)), () => {
      setNotes((n) => n.map((x) => (x.id === id ? { ...x, text: text.trim(), edited: true } : x)));
      setEditing(null);
    });
  }

  function remove(id: string) {
    void act("delete", () => (preview ? Promise.resolve({ ok: true as const }) : deleteDraftNote(postId, id)), () => {
      setNotes((n) => n.filter((x) => x.id !== id));
      setDeleting(null);
    });
  }

  const sendKeys = (e: KeyboardEvent<HTMLTextAreaElement>, send: () => void, cancel?: () => void) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
    if (e.key === "Escape" && cancel) { e.preventDefault(); e.stopPropagation(); cancel(); }
  };

  const notes = state.status === "done" ? state.notes : [];
  const team = state.status === "done" && state.team;
  // Buffer's own wording for a solo account, read from its Notes panel on 4 Nov.
  const visibility = team ? "Everyone with access to this channel in Buffer sees notes." : "Notes are visible only to you.";

  return (
    <section className={styles.notes} aria-labelledby={`notes-${postId}`}>
      <div className={styles.head}>
        <h3 id={`notes-${postId}`} className={styles.h3}>Notes{notes.length > 0 && <span className={styles.count}>{notes.length}{state.status === "done" && state.more ? "+" : ""}</span>}</h3>
        {state.status === "done" && (
          <Tooltip content={visibility} side="top">
            <button type="button" className={styles.info} aria-label={`About note visibility: ${visibility}`}><Info size={14} strokeWidth={1.8} aria-hidden="true" /></button>
          </Tooltip>
        )}
      </div>
      {state.status === "loading" && <Skeleton label="Loading notes" lines={2} avatar />}
      {state.status === "failed" && <p className={styles.muted} role="status">{state.message}</p>}
      {state.status === "done" && (
        <>
          {notes.length === 0 ? (
            <div className={styles.empty}>
              <span className={styles.emptyIcon} aria-hidden="true"><StickyNote size={18} strokeWidth={1.6} /></span>
              <p className={styles.emptyTitle}>No notes yet</p>
              <p className={styles.emptyText}>{team ? "Leave a note for your team." : "Leave a note for yourself."}</p>
            </div>
          ) : (
            <ul className={styles.thread}>
              {notes.map((n) => (
                <li key={n.id} className={styles.note} data-active={editing?.id === n.id || deleting === n.id || undefined}>
                  <Avatar name={n.author ?? "Deleted account"} src={n.avatar ?? undefined} size="sm" className={styles.avatar} />
                  <div className={styles.body}>
                    <div className={styles.meta}>
                      <span className={styles.author}>{n.author ?? "A deleted account"}</span>
                      <time dateTime={n.createdAt} title={new Date(n.createdAt).toLocaleString()}>{when(n.createdAt)}</time>
                      {n.edited && <span>· edited</span>}
                    </div>
                    {editing?.id === n.id ? (
                      <div className={styles.editBox}>
                        <textarea aria-label="Edit note" className={styles.field} value={editing.text} maxLength={MAX_NOTE} autoFocus ref={grow}
                          onChange={(e) => { setEditing({ id: n.id, text: e.target.value }); grow(e.target); }}
                          onKeyDown={(e) => sendKeys(e, () => saveEdit(n.id, editing.text), () => setEditing(null))} />
                        <div className={styles.inline}>
                          <Button size="sm" variant="primary" disabled={busy !== null || !editing.text.trim() || editing.text.trim() === n.text} onClick={() => saveEdit(n.id, editing.text)}>{busy === "edit" ? "Saving…" : "Save"}</Button>
                          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setEditing(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <p className={styles.text}>{n.text}</p>
                    )}
                    {deleting === n.id && (
                      <div className={styles.confirm} role="group" aria-label="Delete this note?">
                        <span>Delete this note? It cannot be undone.</span>
                        <div className={styles.inline}>
                          <Button size="sm" variant="danger" disabled={busy !== null} onClick={() => remove(n.id)}>{busy === "delete" ? "Deleting…" : "Delete"}</Button>
                          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setDeleting(null)}>Keep</Button>
                        </div>
                      </div>
                    )}
                  </div>
                  {editing?.id !== n.id && deleting !== n.id && (n.canEdit || n.canDelete) && (
                    <div className={styles.tools}>
                      {n.canEdit && <button type="button" className={styles.tool} aria-label="Edit note" title="Edit" onClick={() => { setEditing({ id: n.id, text: n.text }); setDeleting(null); setError(null); }}><Pencil size={14} strokeWidth={1.8} aria-hidden="true" /></button>}
                      {n.canDelete && <button type="button" className={styles.tool} data-tone="danger" aria-label="Delete note" title="Delete" onClick={() => { setDeleting(n.id); setEditing(null); setError(null); }}><Trash2 size={14} strokeWidth={1.8} aria-hidden="true" /></button>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {state.more && <p className={styles.muted}>Older notes are in Buffer.</p>}
          <div className={styles.composer} data-busy={busy === "add" || undefined}>
            <textarea ref={composer} aria-label="Add a note" placeholder="Add a note" rows={1} className={styles.field} value={draft} maxLength={MAX_NOTE}
              onChange={(e) => { setDraft(e.target.value); grow(e.target); }} onKeyDown={(e) => sendKeys(e, add)} />
            <button type="button" className={styles.send} aria-label="Send note" title="Send (⌘↵)" disabled={!draft.trim() || busy !== null} onClick={add}>
              <ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
            </button>
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
