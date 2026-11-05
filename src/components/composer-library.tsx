"use client";

/**
 * The composer's Templates and Hashtags buttons, placed in the editor the way schedulers place them: a button in the
 * composer opens a library, and picking an entry puts its text into the post to edit. Each list belongs to one slot or account: callers key
 * this component by that id, so switching accounts starts both lists fresh and never carries one organization's
 * entries or cursor to another. Templates come from Buffer's
 * library (the organization's and the person's own listed first); hashtags are the organization's saved sets. Each list
 * loads when its button is first opened.
 */
import { useMemo, useRef, useState } from "react";
import { Hash, LayoutTemplate } from "lucide-react";
import { readComposerSnippets, readComposerTemplates, type ComposerSnippet, type ComposerTemplate } from "@/app/(app)/library-actions";
import { Popover, PopoverContent, PopoverTrigger } from "@/registry/components/popover/popover";
import styles from "./composer-library.module.css";

type Load<T> = { status: "idle" } | { status: "loading" } | { status: "done"; items: T[]; more: boolean; cursor: string | null; loadingMore?: boolean; moreError?: string } | { status: "failed"; message: string };

/** Templates and Hashtags for one slot; `onInsert` receives the text to put into the post. */
export function ComposerLibrary({ slotId, onInsert, disabled = false }: { slotId: string; onInsert: (text: string, kind: "template" | "hashtags") => void; disabled?: boolean }) {
  const [templates, setTemplates] = useState<Load<ComposerTemplate>>({ status: "idle" });
  const [snippets, setSnippets] = useState<Load<ComposerSnippet>>({ status: "idle" });
  const [openList, setOpenList] = useState<"templates" | "hashtags" | null>(null);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);

  const loadTemplates = () => {
    if (templates.status !== "idle" && templates.status !== "failed") return;
    setTemplates({ status: "loading" });
    readComposerTemplates(slotId)
      .then((r) => setTemplates(r.ok ? { status: "done", items: r.templates, more: r.more, cursor: r.cursor } : { status: "failed", message: r.message }))
      .catch(() => setTemplates({ status: "failed", message: "Buffer did not return the templates." }));
  };
  const loadSnippets = () => {
    if (snippets.status !== "idle" && snippets.status !== "failed") return;
    setSnippets({ status: "loading" });
    readComposerSnippets(slotId)
      .then((r) => setSnippets(r.ok ? { status: "done", items: r.snippets, more: r.more, cursor: r.cursor } : { status: "failed", message: r.message }))
      .catch(() => setSnippets({ status: "failed", message: "Buffer did not return your hashtags." }));
  };
  /** Reads the next batch and adds it to the list; a failure keeps what is loaded and says so. */
  const moreTemplates = () => {
    if (templates.status !== "done" || !templates.cursor || templates.loadingMore) return;
    const at = templates;
    setTemplates({ ...at, loadingMore: true, moreError: undefined });
    readComposerTemplates(slotId, at.cursor)
      .then((r) => setTemplates(r.ok ? { status: "done", items: [...at.items, ...r.templates], more: r.more, cursor: r.cursor } : { ...at, loadingMore: false, moreError: r.message }))
      .catch(() => setTemplates({ ...at, loadingMore: false, moreError: "Buffer did not return more templates." }));
  };
  const moreSnippets = () => {
    if (snippets.status !== "done" || !snippets.cursor || snippets.loadingMore) return;
    const at = snippets;
    setSnippets({ ...at, loadingMore: true, moreError: undefined });
    readComposerSnippets(slotId, at.cursor)
      .then((r) => setSnippets(r.ok ? { status: "done", items: [...at.items, ...r.snippets], more: r.more, cursor: r.cursor } : { ...at, loadingMore: false, moreError: r.message }))
      .catch(() => setSnippets({ ...at, loadingMore: false, moreError: "Buffer did not return more hashtags." }));
  };
  /** The end of a list that Buffer has more of: a button to read the next batch, or why it cannot. */
  const moreFooter = (l: Load<unknown>, onMore: () => void, noun: string) => l.status === "done" && l.more ? (
    <div className={styles.more}>
      <p className={styles.muted}>Showing {l.items.length} {noun}. Search looks only at these.</p>
      {l.cursor ? <button type="button" className={styles.moreButton} disabled={l.loadingMore} onClick={onMore}>{l.loadingMore ? "Loading…" : "Load more"}</button>
        : <p className={styles.muted}>Buffer gave no way to read further here.</p>}
      {l.moreError && <p className={styles.error} role="alert">{l.moreError}</p>}
    </div>
  ) : null;

  const q = query.trim().toLowerCase();
  const shownTemplates = useMemo(() => templates.status === "done" ? templates.items.filter((t) => `${t.title} ${t.description}`.toLowerCase().includes(q)) : [], [templates, q]);
  const shownSnippets = useMemo(() => snippets.status === "done" ? snippets.items.filter((s) => `${s.name} ${s.text}`.toLowerCase().includes(q)) : [], [snippets, q]);
  const yours = shownTemplates.filter((t) => t.mine);
  const library = shownTemplates.filter((t) => !t.mine);

  const pick = (text: string, kind: "template" | "hashtags") => { if (!disabled) onInsert(text, kind); setOpenList(null); };
  const opener = (list: "templates" | "hashtags") => (open: boolean) => {
    setOpenList(open ? list : null);
    if (!open) return;
    setQuery("");
    if (list === "templates") loadTemplates(); else loadSnippets();
  };

  return (
    <div className={styles.bar}>
      <Popover open={openList === "templates"} onOpenChange={opener("templates")}>
        <PopoverTrigger asChild>
          <button type="button" className={styles.tool} disabled={disabled}><LayoutTemplate size={14} strokeWidth={1.8} aria-hidden="true" />Templates</button>
        </PopoverTrigger>
        <PopoverContent className={styles.panel} onOpenAutoFocus={(e) => { e.preventDefault(); search.current?.focus(); }}>
          <input ref={search} className={styles.search} placeholder="Search templates" aria-label="Search templates" value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)} />
          {templates.status === "loading" || templates.status === "idle" ? <p className={styles.muted} role="status">Loading templates…</p>
            : templates.status === "failed" ? <p className={styles.error} role="alert">{templates.message}</p>
            : shownTemplates.length === 0 ? <>
                <p className={styles.muted}>{q ? `No loaded template matches “${query.trim()}”.` : "No templates yet."}</p>
                {moreFooter(templates, moreTemplates, "templates")}
              </>
            : (
              <div className={styles.scroll}>
                {[["Yours", yours], ["Buffer's library", library]].map(([label, list]) => (list as ComposerTemplate[]).length > 0 && (
                  <section key={label as string} aria-label={label as string}>
                    <h3 className={styles.heading}>{label as string}</h3>
                    <ul className={styles.list} role="list">
                      {(list as ComposerTemplate[]).map((t) => (
                        <li key={t.id}>
                          <button type="button" className={styles.option} onClick={() => pick(t.body, "template")}>
                            <span className={styles.emoji} aria-hidden="true">{t.emoji}</span>
                            <span className={styles.text}>
                              <span className={styles.title}>{t.title}</span>
                              {t.description && <span className={styles.description}>{t.description}</span>}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
                {moreFooter(templates, moreTemplates, "templates")}
              </div>
            )}
        </PopoverContent>
      </Popover>

      <Popover open={openList === "hashtags"} onOpenChange={opener("hashtags")}>
        <PopoverTrigger asChild>
          <button type="button" className={styles.tool} disabled={disabled}><Hash size={14} strokeWidth={1.8} aria-hidden="true" />Hashtags</button>
        </PopoverTrigger>
        <PopoverContent className={styles.panel} onOpenAutoFocus={(e) => { e.preventDefault(); search.current?.focus(); }}>
          <input ref={search} className={styles.search} placeholder="Search saved hashtags" aria-label="Search saved hashtags" value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)} />
          {snippets.status === "loading" || snippets.status === "idle" ? <p className={styles.muted} role="status">Loading your hashtags…</p>
            : snippets.status === "failed" ? <p className={styles.error} role="alert">{snippets.message}</p>
            : shownSnippets.length === 0 ? <>
                <p className={styles.muted}>{q ? `No loaded set matches “${query.trim()}”.` : snippets.more ? "None in this batch." : "No saved hashtag sets yet. Save one in Buffer or ask your AI."}</p>
                {moreFooter(snippets, moreSnippets, "sets")}
              </>
            : (
              <div className={styles.scroll}>
              <ul className={styles.list} role="list">
                {shownSnippets.map((s) => (
                  <li key={s.id}>
                    <button type="button" className={styles.option} onClick={() => pick(s.text, "hashtags")}>
                      <span className={styles.text}>
                        <span className={styles.title}>{s.name}</span>
                        <span className={styles.description}>{s.text}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
              {moreFooter(snippets, moreSnippets, "sets")}
              </div>
            )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
