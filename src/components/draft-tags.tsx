"use client";

/**
 * Buffer's tags on the open draft, laid out like Buffer's own picker: the post's tags as small coloured chips under
 * the text, and a tag button that opens a search box, the organization's tags to tick, and "New tag". Changes apply
 * as they are ticked. Only drafts Queue Pilot wrote can be changed here; on any other post the chips are read only.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Plus, Tag } from "lucide-react";
import { createTagForDraft, readDraftTags, setTagsOnDraft, type DraftTag } from "@/app/(app)/tag-actions";
import { Popover, PopoverContent, PopoverTrigger } from "@/registry/components/popover/popover";
import { Button } from "@/registry/components/button/button";
import styles from "./draft-tags.module.css";

type Loaded = { selected: DraftTag[]; all: DraftTag[]; canEdit: boolean };
type State = { status: "loading" } | ({ status: "done" } & Loaded) | { status: "failed"; message: string };

/** Tags for one post in the person's queue; `preview` shows given tags and changes them locally (preview page only). */
export function DraftTags({ postId, preview }: { postId: string; preview?: Loaded }) {
  const [state, setState] = useState<State>(preview ? { status: "done", ...preview } : { status: "loading" });
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const search = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (preview) return;
    let live = true;
    readDraftTags(postId)
      .then((r) => { if (live) setState(r.ok ? { status: "done", selected: r.selected, all: r.all, canEdit: r.canEdit } : { status: "failed", message: r.message }); })
      .catch(() => { if (live) setState({ status: "failed", message: "Buffer did not return the tags." }); });
    return () => { live = false; };
  }, [postId, preview]);

  const done = state.status === "done" ? state : null;
  const q = query.trim();
  const shown = useMemo(() => (done ? done.all.filter((t) => t.name.toLowerCase().includes(q.toLowerCase())) : []), [done, q]);
  const exact = done?.all.some((t) => t.name.toLowerCase() === q.toLowerCase());

  /** Applies a new tag list, showing it at once and putting the old one back if Buffer refuses. */
  async function apply(next: DraftTag[], all?: DraftTag[]) {
    if (!done) return;
    const before = done;
    setState({ ...done, selected: next, all: all ?? done.all });
    setError(null);
    if (preview) return;
    setBusy(true);
    const r = await setTagsOnDraft(postId, next.map((t) => t.id)).catch(() => ({ ok: false as const, message: "Buffer did not answer. Try again in a minute." }));
    setBusy(false);
    if (!r.ok) { setState(before); setError(r.message); }
  }

  function toggle(tag: DraftTag) {
    if (!done || busy) return;
    const on = done.selected.some((t) => t.id === tag.id);
    void apply(on ? done.selected.filter((t) => t.id !== tag.id) : [...done.selected, tag]);
  }

  async function create() {
    if (!done || busy || !q || exact) return;
    setError(null);
    if (preview) { const tag = { id: `local-${Date.now()}`, name: q, color: "#8F2457" }; setQuery(""); return apply([...done.selected, tag], [...done.all, tag]); }
    setBusy(true);
    const r = await createTagForDraft(postId, q).catch(() => ({ ok: false as const, message: "Buffer did not answer, so the tag may be saved. Reopen the post before adding it again." }));
    setBusy(false);
    if (!r.ok) { setError(r.message); return; }
    setQuery("");
    await apply([...done.selected, r.tag], [...done.all, r.tag]);
  }

  if (state.status === "loading") return <div className={styles.row} aria-hidden="true" />;
  if (state.status === "failed") return <p className={styles.muted} role="status">{state.message}</p>;
  if (!state.canEdit && state.selected.length === 0) return null;

  return (
    <div className={styles.wrap}>
      <div className={styles.row}>
        {state.selected.length > 0 && (
          <ul className={styles.chips} aria-label="Tags">
            {state.selected.map((t) => <li key={t.id} className={styles.chip}><span className={styles.dot} style={{ background: t.color }} aria-hidden="true" />{t.name}</li>)}
          </ul>
        )}
        {state.canEdit && (
          <Popover onOpenChange={(open) => { if (open) { setQuery(""); setError(null); } }}>
            <PopoverTrigger asChild>
              <button type="button" className={styles.add} aria-label={state.selected.length ? "Change tags" : "Add tags"} title="Tags">
                <Tag size={14} strokeWidth={1.8} aria-hidden="true" /><Plus size={10} strokeWidth={2.4} className={styles.plus} aria-hidden="true" />
              </button>
            </PopoverTrigger>
            <PopoverContent className={styles.panel} onOpenAutoFocus={(e) => { e.preventDefault(); search.current?.focus(); }}>
              <input ref={search} className={styles.search} placeholder="Search tags" aria-label="Search tags" value={query} maxLength={100}
                onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); if (shown.length === 1 && exact) toggle(shown[0]); else void create(); } }} />
              {state.all.length === 0 && !q ? (
                <div className={styles.empty}>
                  <span className={styles.emptyIcon} aria-hidden="true"><Tag size={18} strokeWidth={1.6} /></span>
                  <p>There are no tags yet.</p>
                  <p className={styles.muted}>Type a name to make one.</p>
                </div>
              ) : (
                <ul className={styles.list} role="list">
                  {shown.map((t) => {
                    const on = state.selected.some((s) => s.id === t.id);
                    return (
                      <li key={t.id}>
                        <button type="button" className={styles.option} aria-pressed={on} disabled={busy} onClick={() => toggle(t)}>
                          <span className={styles.dot} style={{ background: t.color }} aria-hidden="true" />
                          <span className={styles.name}>{t.name}</span>
                          {on && <Check size={14} strokeWidth={2} className={styles.check} aria-hidden="true" />}
                        </button>
                      </li>
                    );
                  })}
                  {q && shown.length === 0 && <li className={styles.muted}>No tag named “{q}”.</li>}
                </ul>
              )}
              {q && !exact && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void create()}>{busy ? "Creating…" : `New tag “${q}”`}</Button>}
              {error && <p className={styles.error} role="alert">{error}</p>}
            </PopoverContent>
          </Popover>
        )}
      </div>
    </div>
  );
}
