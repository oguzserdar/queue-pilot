"use client";

/**
 * The @mention picker for a note field in the draft window. Typing "@" at the start of a word lists the teammates who
 * can read notes on the post's channel; arrows move, Enter or Tab picks, Escape closes. Picking writes "@Name " into
 * the text and remembers who it was, so the note is sent with that mention. Locked members (viewer access in Buffer)
 * are listed but cannot be picked. The list sits under the field, in the same quiet rows as the notes thread.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { insertMention, matchTeammates, mentionQuery, type NoteTeammate, type PickedMention } from "@/lib/note-mention-picker";
import { Avatar } from "@/registry/components/avatar/avatar";
import styles from "./draft-notes.module.css";

/** Reads the teammates for this post: the whole list, or a search when the list is longer than one read. */
export type TeammateSource = (search?: string) => Promise<{ teammates: NoteTeammate[]; more: boolean } | null>;

type Options = {
  text: string;
  setText: (text: string) => void;
  picked: PickedMention[];
  setPicked: (picked: PickedMention[]) => void;
  field: RefObject<HTMLTextAreaElement | null>;
  /** Null turns the picker off (a solo account has no one to mention). */
  source: TeammateSource | null;
};

type Loaded = { teammates: NoteTeammate[]; more: boolean };

/** The teammates to match against: a search's result once it is back, else the list read first; none before that. */
function poolFor(all: Loaded | null | "failed", query: string, found: Record<string, NoteTeammate[]>): NoteTeammate[] {
  if (typeof all !== "object" || !all) return [];
  return all.more && query ? found[query] ?? all.teammates : all.teammates;
}

/** The "@" query at the caret, and whether the list is open for it (not after Escape closed it there). */
function openQuery(text: string, caret: number | null, on: boolean, dismissed: number | null) {
  const q = on && caret !== null ? mentionQuery(text, caret) : null;
  return { q, open: !!q && q.start !== dismissed, query: q?.query.trim() ?? "" };
}

/** A team longer than one read is searched in Buffer for a query not searched yet. */
function needsSearch(open: boolean, all: Loaded | null | "failed", query: string, found: Record<string, NoteTeammate[]>): boolean {
  if (!open || typeof all !== "object" || !all?.more || !query) return false;
  return !(query in found);
}

/** The quiet line under the list: loading, a failed read, no match, or nothing when there are options. */
function statusLine(loading: boolean, failed: boolean, options: number, query: string): string {
  if (loading) return "Loading teammates…";
  if (failed) return "Buffer did not return your teammates. Type the note without a mention, or try again.";
  return options ? "" : `No teammate matches “${query}”.`;
}

/** The open list under the field: the matching teammates (locked ones say so) and one quiet status line. */
function MentionList({ box, listId, optionId, options, at, status, onHover, onPick }: {
  box: RefObject<HTMLDivElement | null>;
  listId: string;
  optionId: (i: number) => string;
  options: NoteTeammate[];
  at: number;
  status: string;
  onHover: (i: number) => void;
  onPick: (t: NoteTeammate) => void;
}) {
  return (
    <div ref={box} className={styles.mentions}>
      {options.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Teammates" className={styles.mentionList}>
          {options.map((t, i) => (
            <li key={t.urn} id={optionId(i)} role="option" aria-selected={i === at} className={styles.mentionOption}
              onMouseDown={(e) => e.preventDefault()} onPointerMove={() => i !== at && onHover(i)} onClick={() => onPick(t)}
              title={t.locked ? "Locked in Buffer: they can read this note and be mentioned, but get no notification while locked." : undefined}>
              <Avatar name={t.name} src={t.avatar ?? undefined} size="sm" aria-hidden="true" />
              <span className={styles.mentionText}>
                <span className={styles.author}>{t.name}</span>
                <span className={styles.muted}>{t.locked ? "Locked in Buffer, gets no notification" : t.email}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className={styles.muted} role="status" aria-live="polite">{status}</p>
    </div>
  );
}

/**
 * Wires the picker to one textarea.
 *
 * @returns Props for the textarea, a key handler that reports whether it used the key, and the list to render under it
 * @example
 * ```tsx
 * const mentions = useNoteMentions({ text, setText, picked, setPicked, field: ref, source });
 * <textarea {...mentions.fieldProps} onKeyDown={(e) => { if (!mentions.onKeyDown(e)) send(e); }} />
 * {mentions.list}
 * ```
 */
export function useNoteMentions({ text, setText, picked, setPicked, field, source }: Options) {
  const uid = useId();
  const [caret, setCaret] = useState<number | null>(null);
  // Null until the read answers; the read starts once, when "@" is first typed in this field.
  const [all, setAll] = useState<Loaded | null | "failed">(null);
  const asked = useRef(false);
  const [found, setFound] = useState<Record<string, NoteTeammate[]>>({});
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);

  const { q, open, query } = openQuery(text, caret, source !== null, dismissed);

  // The list is read once, when "@" is first typed in this field.
  useEffect(() => {
    if (!open || asked.current || !source) return;
    asked.current = true;
    source().then((r) => setAll(r ?? "failed"), () => setAll("failed"));
  }, [open, source]);

  // A team longer than one read is searched in Buffer as the person types, a moment after they pause.
  const searching = needsSearch(open, all, query, found);
  useEffect(() => {
    if (!searching || !source) return;
    const t = setTimeout(() => { source(query).then((r) => r && setFound((f) => ({ ...f, [query]: r.teammates })), () => {}); }, 250);
    return () => clearTimeout(t);
  }, [searching, query, source]);

  const pool = poolFor(all, query, found);
  const options = open && q ? matchTeammates(pool, q.query) : [];
  const at = Math.min(active, Math.max(0, options.length - 1));
  const listId = `${uid}-teammates`;
  const optionId = (i: number) => `${uid}-teammate-${i}`;

  function track(el: HTMLTextAreaElement) {
    const next = el.selectionStart === el.selectionEnd ? el.selectionStart : null;
    if (next !== caret) setActive(0);
    setCaret(next);
    if (dismissed !== null && (next === null || mentionQuery(el.value, next)?.start !== dismissed)) setDismissed(null);
  }

  function choose(t: NoteTeammate | undefined) {
    if (!t || !q || caret === null) return;
    const r = insertMention(text, q.start, caret, t.name);
    setText(r.text);
    setPicked([...picked, { urn: t.urn, name: t.name }]);
    setDismissed(q.start);
    setCaret(r.caret);
    requestAnimationFrame(() => { field.current?.focus(); field.current?.setSelectionRange(r.caret, r.caret); });
  }

  /** Handles the picker's keys while it is open; returns true when the key was used. */
  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): boolean {
    if (!open || e.metaKey || e.ctrlKey) return false;
    if ((e.key === "ArrowDown" || e.key === "ArrowUp") && options.length) {
      e.preventDefault();
      setActive((at + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
      return true;
    }
    if (!e.nativeEvent.isComposing && (e.key === "Enter" || e.key === "Tab") && !e.shiftKey && options.length) {
      e.preventDefault();
      choose(options[at]);
      return true;
    }
    if (e.key === "Escape" && q) {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(q.start);
      return true;
    }
    return false;
  }

  // Open with a source and no answer yet means the read is on its way.
  const loading = (all === null && open && source !== null) || (!!searching && !options.length);
  const status = statusLine(loading, all === "failed", options.length, q?.query ?? "");

  const fieldProps = {
    role: "combobox" as const,
    "aria-autocomplete": "list" as const,
    "aria-expanded": open,
    "aria-controls": open ? listId : undefined,
    "aria-activedescendant": open && options.length ? optionId(at) : undefined,
    onSelect: (e: { currentTarget: HTMLTextAreaElement }) => track(e.currentTarget),
    onBlur: () => setCaret(null),
  };

  // A list that opens under a field (editing a note in the middle of the list) can start below the visible part of the
  // draft window: bring it into view when it opens.
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open) box.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  const list = open ? <MentionList box={box} listId={listId} optionId={optionId} options={options} at={at} status={status} onHover={setActive} onPick={choose} /> : null;

  return { fieldProps, onKeyDown, list, track };
}
