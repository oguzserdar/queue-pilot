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
  const [all, setAll] = useState<{ teammates: NoteTeammate[]; more: boolean } | null | "loading" | "failed">(null);
  const [found, setFound] = useState<Record<string, NoteTeammate[]>>({});
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState<number | null>(null);

  const q = source && caret !== null ? mentionQuery(text, caret) : null;
  const open = !!q && q.start !== dismissed;
  const query = q?.query.trim() ?? "";

  // The list is read once, when "@" is first typed in this field.
  useEffect(() => {
    if (!open || all !== null || !source) return;
    setAll("loading");
    source().then((r) => setAll(r ?? "failed"), () => setAll("failed"));
  }, [open, all, source]);

  // A team longer than one read is searched in Buffer as the person types, a moment after they pause.
  const searching = open && typeof all === "object" && all?.more && query && !(query in found);
  useEffect(() => {
    if (!searching || !source) return;
    const t = setTimeout(() => { source(query).then((r) => r && setFound((f) => ({ ...f, [query]: r.teammates })), () => {}); }, 250);
    return () => clearTimeout(t);
  }, [searching, query, source]);

  const pool = typeof all === "object" && all ? (all.more && query ? found[query] ?? all.teammates : all.teammates) : [];
  const options = open ? matchTeammates(pool, q!.query) : [];
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
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setDismissed(q!.start);
      return true;
    }
    return false;
  }

  const status = all === "loading" || (searching && !options.length) ? "Loading teammates…" : all === "failed" ? "Buffer did not return your teammates. Type the note without a mention, or try again." : options.length ? "" : `No teammate matches “${q?.query ?? ""}”.`;

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

  const list = open ? (
    <div ref={box} className={styles.mentions}>
      {options.length > 0 && (
        <ul id={listId} role="listbox" aria-label="Teammates" className={styles.mentionList}>
          {options.map((t, i) => (
            <li key={t.urn} id={optionId(i)} role="option" aria-selected={i === at} className={styles.mentionOption}
              onMouseDown={(e) => e.preventDefault()} onPointerMove={() => i !== at && setActive(i)} onClick={() => choose(t)}
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
  ) : null;

  return { fieldProps, onKeyDown, list, track };
}
