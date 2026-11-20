"use client";

/**
 * Buffer's Notes on the open draft, laid out like Buffer's own Notes panel: a short thread (picture or initials, name,
 * time, "edited"), Edit and Delete on hover for notes Buffer lets this person change, and one "Add a note" box with a
 * send button (Cmd/Ctrl+Enter). Worded by account: a solo Buffer account leaves notes for itself; a team account is
 * told who can see them. On a team account, "@" in either box mentions a teammate who can read notes on that channel.
 * Every note lives in Buffer; Queue Pilot keeps none and never treats one as an instruction.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
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
const LOADING: State = { status: "loading" };

/** A note's date past a week: "8 Nov", in the reader's own language. */
const NOTE_DAY: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };

/** Grows a textarea with its text, up to the CSS max-height. */
const grow = (el: HTMLTextAreaElement | null) => { if (el) { el.style.height = "auto"; el.style.height = `${el.scrollHeight}px`; } };

/** The picked teammates still named in the text, as a note's mentions. */
const kept = (picked: PickedMention[], urns: string[]): DraftMention[] => urns.flatMap((u) => picked.filter((p) => p.urn === u).slice(0, 1));

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

/** Cmd/Ctrl+Enter sends a note box; Escape cancels it when it can be cancelled. */
function sendKeys(e: KeyboardEvent<HTMLTextAreaElement>, send: () => void, cancel?: () => void) {
  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); }
  if (e.key === "Escape" && cancel) { e.preventDefault(); e.stopPropagation(); cancel(); }
}

type Busy = "add" | "edit" | "delete" | null;

/** The heading with the note count ("+" when Buffer has older ones), and who can see notes once that is known. */
function NotesHead({ postId, count, more, visibility }: { postId: string; count: number; more: boolean; visibility: string | null }) {
  return (
    <div className={styles.head}>
      <h3 id={`notes-${postId}`} className={styles.h3}>Notes{count > 0 && <span className={styles.count}>{count}{more ? "+" : ""}</span>}</h3>
      {visibility !== null && (
        <Tooltip content={visibility} side="top">
          <button type="button" className={styles.info} aria-label={`About note visibility: ${visibility}`}><Info size={14} strokeWidth={1.8} aria-hidden="true" /></button>
        </Tooltip>
      )}
    </div>
  );
}

/** No notes on the post yet, worded for a team or a solo account. */
function NoNotes({ team }: { team: boolean }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon} aria-hidden="true"><StickyNote size={18} strokeWidth={1.6} /></span>
      <p className={styles.emptyTitle}>No notes yet</p>
      <p className={styles.emptyText}>{team ? "Leave a note for your team." : "Leave a note for yourself."}</p>
    </div>
  );
}

/** The "Add a note" box with its send button and @mention list. */
function NoteComposer({ field, draft, busy, canMention, mentions, onDraft, onSend }: { field: RefObject<HTMLTextAreaElement | null>; draft: string; busy: Busy; canMention: boolean; mentions: ReturnType<typeof useNoteMentions>; onDraft: (text: string) => void; onSend: () => void }) {
  return (
    <div className={styles.composer} data-busy={busy === "add" || undefined}>
      <textarea ref={field} aria-label="Add a note" placeholder={canMention ? "Add a note, or @ a teammate" : "Add a note"} rows={1} className={styles.field} value={draft} maxLength={MAX_NOTE} {...mentions.fieldProps}
        onChange={(e) => { onDraft(e.target.value); grow(e.target); mentions.track(e.target); }} onKeyDown={(e) => { if (!mentions.onKeyDown(e)) sendKeys(e, onSend); }} />
      <button type="button" className={styles.send} aria-label="Send note" title="Send (⌘↵)" disabled={!draft.trim() || busy !== null} onClick={onSend}>
        <ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
      </button>
      {mentions.list}
    </div>
  );
}

/** One note being edited: its text box with @mentions, Save and Cancel. */
function EditBox({ note, text, busy, mentions, editRef, onText, onSave, onCancel }: { note: DraftNote; text: string; busy: Busy; mentions: ReturnType<typeof useNoteMentions>; editRef: (el: HTMLTextAreaElement | null) => void; onText: (text: string) => void; onSave: () => void; onCancel: () => void }) {
  return (
    <div className={styles.editBox}>
      <textarea aria-label="Edit note" className={styles.field} value={text} maxLength={MAX_NOTE} autoFocus ref={editRef} {...mentions.fieldProps}
        onChange={(e) => { onText(e.target.value); grow(e.target); mentions.track(e.target); }}
        onKeyDown={(e) => { if (!mentions.onKeyDown(e)) sendKeys(e, onSave, onCancel); }} />
      {mentions.list}
      <div className={styles.inline}>
        <Button size="sm" variant="primary" disabled={busy !== null || !text.trim() || text.trim() === note.text} onClick={onSave}>{busy === "edit" ? "Saving…" : "Save"}</Button>
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

/** Asks before a note is deleted: Delete or Keep. */
function DeleteConfirm({ busy, onDelete, onKeep }: { busy: Busy; onDelete: () => void; onKeep: () => void }) {
  return (
    <div className={styles.confirm} role="group" aria-label="Delete this note?">
      <span>Delete this note? It cannot be undone.</span>
      <div className={styles.inline}>
        <Button size="sm" variant="danger" disabled={busy !== null} onClick={onDelete}>{busy === "delete" ? "Deleting…" : "Delete"}</Button>
        <Button size="sm" variant="ghost" disabled={busy !== null} onClick={onKeep}>Keep</Button>
      </div>
    </div>
  );
}

/** Edit and Delete for a note Buffer lets this person change. */
function NoteTools({ note, onEdit, onDelete }: { note: DraftNote; onEdit: () => void; onDelete: () => void }) {
  if (!note.canEdit && !note.canDelete) return null;
  return (
    <div className={styles.tools}>
      {note.canEdit && <button type="button" className={styles.tool} aria-label="Edit note" title="Edit" onClick={onEdit}><Pencil size={14} strokeWidth={1.8} aria-hidden="true" /></button>}
      {note.canDelete && <button type="button" className={styles.tool} data-tone="danger" aria-label="Delete note" title="Delete" onClick={onDelete}><Trash2 size={14} strokeWidth={1.8} aria-hidden="true" /></button>}
    </div>
  );
}

/** One note in the thread: who and when, its text (or the edit box), the delete question, and its tools. */
function NoteRow({ note: n, editing, deleting, busy, mentions, editRef, onEditText, onSave, onCancelEdit, onStartEdit, onAskDelete, onDelete, onKeep }: {
  note: DraftNote;
  /** The text being edited, when this note is the one being edited. */
  editing: string | null;
  deleting: boolean;
  busy: Busy;
  mentions: ReturnType<typeof useNoteMentions>;
  editRef: (el: HTMLTextAreaElement | null) => void;
  onEditText: (text: string) => void;
  onSave: (text: string) => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
  onAskDelete: () => void;
  onDelete: () => void;
  onKeep: () => void;
}) {
  return (
    <li className={styles.note} data-active={editing !== null || deleting || undefined}>
      <Avatar name={n.author ?? "Deleted account"} src={n.avatar ?? undefined} size="sm" className={styles.avatar} />
      <div className={styles.body}>
        <div className={styles.meta}>
          <span className={styles.author}>{n.author ?? "A deleted account"}</span>
          {/* Filled in after load, in the reader's language and time zone, so the server's text never differs. */}
          <LocalTime iso={n.createdAt} options={NOTE_DAY} relative />
          {n.edited && <span>· edited</span>}
        </div>
        {editing !== null
          ? <EditBox note={n} text={editing} busy={busy} mentions={mentions} editRef={editRef} onText={onEditText} onSave={() => onSave(editing)} onCancel={onCancelEdit} />
          : <p className={styles.text}>{withMentions(n.text, n.mentions)}</p>}
        {deleting && <DeleteConfirm busy={busy} onDelete={onDelete} onKeep={onKeep} />}
      </div>
      {editing === null && !deleting && <NoteTools note={n} onEdit={onStartEdit} onDelete={onAskDelete} />}
    </li>
  );
}

/** Notes for one post in the person's queue; `preview` shows given notes and changes them locally (preview page only). */
export function DraftNotes({ postId, preview }: { postId: string; preview?: NotesPreview }) {
  // The notes held belong to one post; while another post's are on their way, this one shows as loading.
  const [held, setHeld] = useState<{ postId: string; state: State }>(() => ({ postId, state: preview ? { status: "done", notes: preview.notes, more: preview.more, team: preview.team } : LOADING }));
  const state: State = held.postId === postId ? held.state : LOADING;
  const [draft, setDraft] = useState("");
  const [picked, setPicked] = useState<PickedMention[]>([]);
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);
  const [editPicked, setEditPicked] = useState<PickedMention[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [busy, setBusy] = useState<Busy>(null);
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
    readDraftNotes(postId)
      .then((r) => { if (live) setHeld({ postId, state: r.ok ? { status: "done", notes: r.notes, more: r.more, team: r.team } : { status: "failed", message: r.message } }); })
      .catch(() => { if (live) setHeld({ postId, state: { status: "failed", message: "Buffer did not return the notes. Try again in a minute." } }); });
    return () => { live = false; };
  }, [postId, preview]);

  const setNotes = (next: (n: DraftNote[]) => DraftNote[]) => setHeld((h) => (h.postId === postId && h.state.status === "done" ? { postId, state: { ...h.state, notes: next(h.state.notes) } } : h));

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

  const notes = state.status === "done" ? state.notes : [];
  // Buffer's own wording for a solo account, read from its Notes panel on 4 Nov.
  const visibility = team ? "Everyone with access to this channel in Buffer sees notes." : "Notes are visible only to you.";

  return (
    <section className={styles.notes} aria-labelledby={`notes-${postId}`}>
      <NotesHead postId={postId} count={notes.length} more={state.status === "done" && state.more} visibility={state.status === "done" ? visibility : null} />
      {state.status === "loading" && <Skeleton label="Loading notes" lines={2} avatar />}
      {state.status === "failed" && <p className={styles.muted} role="status">{state.message}</p>}
      {state.status === "done" && (
        <>
          {notes.length === 0 ? <NoNotes team={!!team} /> : (
            <ul className={styles.thread}>
              {notes.map((n) => (
                <NoteRow key={n.id} note={n} editing={editing?.id === n.id ? editing.text : null} deleting={deleting === n.id} busy={busy} mentions={editMentions} editRef={editRef}
                  onEditText={(text) => setEditing({ id: n.id, text })} onSave={(text) => saveEdit(n.id, text)} onCancelEdit={() => setEditing(null)}
                  onStartEdit={() => startEdit(n)} onAskDelete={() => { setDeleting(n.id); setEditing(null); setError(null); }} onDelete={() => remove(n.id)} onKeep={() => setDeleting(null)} />
              ))}
            </ul>
          )}
          {state.more && <p className={styles.muted}>Older notes are in Buffer.</p>}
          <NoteComposer field={composer} draft={draft} busy={busy} canMention={source !== null} mentions={addMentions} onDraft={setDraft} onSend={add} />
          {error && <p className={styles.error} role="alert">{error}</p>}
        </>
      )}
    </section>
  );
}
