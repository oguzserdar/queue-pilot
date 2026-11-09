"use client";

/**
 * Buffer's Notes on the open draft, laid out like Buffer's own Notes panel: a short thread (picture or initials, name,
 * time, "edited"), Edit and Delete on hover for notes Buffer lets this person change, and one "Add a note" box with a
 * send button (Cmd/Ctrl+Enter). Worded by account: a solo Buffer account leaves notes for itself; a team account is
 * told who can see them. On a team account, "@" in either box mentions a teammate who can read notes on that channel.
 * Every note lives in Buffer; Queue Pilot keeps none and never treats one as an instruction.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Info, Pencil, StickyNote, Trash2 } from "lucide-react";
import { addDraftNote, deleteDraftNote, editDraftNote, listNoteTeammates, readDraftNotes, type DraftMention, type DraftNote } from "@/app/(app)/note-actions";
import { MAX_NOTE } from "@/lib/buffer/note-limits";
import { mentionsInText, type NoteTeammate, type PickedMention } from "@/lib/note-mention-picker";
import { useNoteMentions, type TeammateSource } from "./note-mention-picker";
import { Avatar } from "@/registry/components/avatar/avatar";
import { Skeleton } from "@/registry/components/skeleton/skeleton";
import { Button } from "@/registry/components/button/button";
import { Tooltip } from "@/registry/components/tooltip/tooltip";
import { LocalTime } from "./local-time";
import styles from "./draft-notes.module.css";

type Loaded = { notes: DraftNote[]; more: boolean; team: boolean };
/** Notes the preview page shows without Buffer, with the teammates its picker offers. */
export type NotesPreview = Loaded & { teammates?: NoteTeammate[] };
type State = { status: "loading" } | ({ status: "done" } & Loaded) | { status: "failed"; message: string };
type Result = { ok: true } | { ok: false; message: string };

/** A note's date past a week: "8 Nov", in the reader's own language. */
const NOTE_DAY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

/** Grows a textarea with its text, up to the CSS max-height. */
const grow = (el: HTMLTextAreaElement | null) => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } };

/** The picked teammates still named in the text, as a note's mentions. */
const kept = (picked: PickedMention[], urns: string[]): DraftMention[] => urns.map((u) => picked.find((p) => p.urn === u)!).filter(Boolean);

/** A note's text with each mentioned @Name set apart, the way Buffer shows a mention. */
function withMentions(text: string, mentions: DraftMention[] = []): ReactNode {
  const names = [...new Set(mentions.map((m) => `@${m.name}`))].sort((a, b) => b.length - a.length);
  if (!names.length) return text;
  const parts: ReactNode[] = [];
  let rest = text;
  let key = 0;
  for (;;) {
    const hits = names.map((n) => ({ n, at: rest.indexOf(n) })).filter((h) => h.at >= 0).sort((a, b) => a.at - b.at);
    if (!hits.length) break;
    const { n, at } = hits[0];
    parts.push(rest.slice(0, at), <span key={key++} className={styles.mention}>{n}</span>);
    rest = rest.slice(at + n.length);
  }
  parts.push(rest);
  return parts;
}

/** Notes for one post in the person's queue; `preview` shows given notes and changes them locally (preview page only). */
export function DraftNotes({ postId, preview }: { postId: string; preview?: NotesPreview }) {
  const [state, setState] = useState<State>(preview ? { status: "done", notes: preview.notes, more: preview.more, team: preview.team } : { status: "loading" });
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<PickedMention[]>([]);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [editPicked, setEditPicked] = useState<PickedMention[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState<"add" | "edit" | "delete" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const editField = useRef<HTMLTextAreaElement | null>(null);
  const editRef = useCallback((el: HTMLTextAreaElement | null) => { editField.current = el; grow(el); }, []);

  // Teammates to @mention: the example's own list without any call, or Buffer's list for this post's channel on a team.
  const team = state.status === "done" && state.team;
  const exampleTeam = preview?.teammates;
  const source = useMemo<TeammateSource | null>(() => {
    if (preview) return exampleTeam ? async () => ({ teammates: exampleTeam, more: false }) : null;
    if (!team) return null;
    return async (search) => { const r = await listNoteTeammates(postId, search); return r.ok ? { teammates: r.teammates, more: r.more } : null; };
  }, [preview, exampleTeam, team, postId]);
  const addMentions = useNoteMentions({ text: draft, setText: (t) => { setDraft(t); requestAnimationFrame(() => grow(composer.current)); }, picked, setPicked, field: composer, source });
  const editMentions = useNoteMentions({ text: editing?.text ?? "", setText: (t) => { setEditing((e) => (e ? { ...e, text: t } : e)); requestAnimationFrame(() => grow(editField.current)); }, picked: editPicked, setPicked: setEditPicked, field: editField, source });

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
    const urns = mentionsInText(text, picked);
    let saved: DraftNote | null = null;
    void act("add", async () => {
      if (preview) { saved = { id: `local-${Date.now()}`, author: "You", avatar: null, createdAt: new Date().toISOString(), edited: false, text, mentions: kept(picked, urns), canEdit: true, canDelete: true }; return { ok: true }; }
      const r = await addDraftNote(postId, text, urns);
      if (r.ok) saved = r.note;
      return r;
    }, () => { const s = saved; if (s) setNotes((n) => [s, ...n]); setDraft(""); setPicked([]); requestAnimationFrame(() => grow(composer.current)); });
  }

  function saveEdit(id: string, text: string) {
    if (!text.trim() || busy) return;
    const urns = mentionsInText(text, editPicked);
    void act("edit", () => (preview ? Promise.resolve({ ok: true as const }) : editDraftNote(postId, id, text, urns)), () => {
      setNotes((n) => n.map((x) => (x.id === id ? { ...x, text: text.trim(), mentions: kept(editPicked, urns), edited: true } : x)));
      setEditing(null);
    });
  }

  function startEdit(n: DraftNote) {
    setEditing({ id: n.id, text: n.text });
    setEditPicked(n.mentions ?? []);
    setDeleting(null);
    setError(null);
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
                      {/* Filled in after load, in the reader's language and time zone, so the server's text never differs. */}
                      <LocalTime iso={n.createdAt} options={NOTE_DAY} relative />
                      {n.edited && <span>· edited</span>}
                    </div>
                    {editing?.id === n.id ? (
                      <div className={styles.editBox}>
                        <textarea aria-label="Edit note" className={styles.field} value={editing.text} maxLength={MAX_NOTE} autoFocus ref={editRef} {...editMentions.fieldProps}
                          onChange={(e) => { setEditing({ id: n.id, text: e.target.value }); grow(e.target); editMentions.track(e.target); }}
                          onKeyDown={(e) => { if (!editMentions.onKeyDown(e)) sendKeys(e, () => saveEdit(n.id, editing.text), () => setEditing(null)); }} />
                        {editMentions.list}
                        <div className={styles.inline}>
                          <Button size="sm" variant="primary" disabled={busy !== null || !editing.text.trim() || editing.text.trim() === n.text} onClick={() => saveEdit(n.id, editing.text)}>{busy === "edit" ? "Saving…" : "Save"}</Button>
                          <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => setEditing(null)}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <p className={styles.text}>{withMentions(n.text, n.mentions)}</p>
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
                      {n.canEdit && <button type="button" className={styles.tool} aria-label="Edit note" title="Edit" onClick={() => startEdit(n)}><Pencil size={14} strokeWidth={1.8} aria-hidden="true" /></button>}
                      {n.canDelete && <button type="button" className={styles.tool} data-tone="danger" aria-label="Delete note" title="Delete" onClick={() => { setDeleting(n.id); setEditing(null); setError(null); }}><Trash2 size={14} strokeWidth={1.8} aria-hidden="true" /></button>}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
          {state.more && <p className={styles.muted}>Older notes are in Buffer.</p>}
          <div className={styles.composer} data-busy={busy === "add" || undefined}>
            <textarea ref={composer} aria-label="Add a note" placeholder={source ? "Add a note, or @ a teammate" : "Add a note"} rows={1} className={styles.field} value={draft} maxLength={MAX_NOTE} {...addMentions.fieldProps}
              onChange={(e) => { setDraft(e.target.value); grow(e.target); addMentions.track(e.target); }} onKeyDown={(e) => { if (!addMentions.onKeyDown(e)) sendKeys(e, add); }} />
            <button type="button" className={styles.send} aria-label="Send note" title="Send (⌘↵)" disabled={!draft.trim() || busy !== null} onClick={add}>
              <ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
            </button>
            {addMentions.list}
          </div>
          {error && <p className={styles.error} role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
