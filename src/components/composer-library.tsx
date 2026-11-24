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
/** One batch read from Buffer, in the same shape for templates and hashtag sets. */
type Batch<T> = { ok: true; items: T[]; more: boolean; cursor: string | null } | { ok: false; message: string };

/**
 * One library list that loads when first opened and reads further batches on demand. A failed first read can be tried
 * again by opening the list again; a failed further read keeps what is loaded and says so.
 */
function usePagedList<T>(read: (cursor?: string) => Promise<Batch<T>>, failed: string, moreFailed: string) {
  const [list, setList] = useState<Load<T>>({ status: "idle" });
  const load = () => {
    if (list.status !== "idle" && list.status !== "failed") return;
    setList({ status: "loading" });
    read()
      .then((r) => setList(r.ok ? { status: "done", items: r.items, more: r.more, cursor: r.cursor } : { status: "failed", message: r.message }))
      .catch(() => setList({ status: "failed", message: failed }));
  };
  /** Reads the next batch and adds it to the list; a failure keeps what is loaded and says so. */
  const more = () => {
    if (list.status !== "done" || !list.cursor || list.loadingMore) return;
    const at = list;
    setList({ ...at, loadingMore: true, moreError: undefined });
    read(at.cursor ?? undefined)
      .then((r) => setList(r.ok ? { status: "done", items: [...at.items, ...r.items], more: r.more, cursor: r.cursor } : { ...at, loadingMore: false, moreError: r.message }))
      .catch(() => setList({ ...at, loadingMore: false, moreError: moreFailed }));
  };
  return { list, load, more };
}

/** The end of a list that Buffer has more of: a button to read the next batch, or why it cannot. */
function MoreFooter({ list: l, onMore, noun }: { list: Load<unknown>; onMore: () => void; noun: string }) {
  if (l.status !== "done" || !l.more) return null;
  return (
    <div className={styles.more}>
      <p className={styles.muted}>Showing {l.items.length} {noun}. Search looks only at these.</p>
      {l.cursor ? <button type="button" className={styles.moreButton} disabled={l.loadingMore} onClick={onMore}>{l.loadingMore ? "Loading…" : "Load more"}</button>
        : <p className={styles.muted}>Buffer gave no way to read further here.</p>}
      {l.moreError && <p className={styles.error} role="alert">{l.moreError}</p>}
    </div>
  );
}

/** Loading or a failed read, said in the panel; null once the list is read. */
function ListState({ list, loading }: { list: Load<unknown>; loading: string }) {
  if (list.status === "loading" || list.status === "idle") return <p className={styles.muted} role="status">{loading}</p>;
  if (list.status === "failed") return <p className={styles.error} role="alert">{list.message}</p>;
  return null;
}

/** The templates found, the person's own first, then Buffer's library. */
function TemplateGroups({ templates, onPick }: { templates: ComposerTemplate[]; onPick: (body: string) => void }) {
  const groups = [{ label: "Yours", list: templates.filter((t) => t.mine) }, { label: "Buffer's library", list: templates.filter((t) => !t.mine) }];
  return groups.map(({ label, list }) => list.length > 0 && (
    <section key={label} aria-label={label}>
      <h3 className={styles.heading}>{label}</h3>
      <ul className={styles.list} role="list">
        {list.map((t) => (
          <li key={t.id}>
            <button type="button" className={styles.option} onClick={() => onPick(t.body)}>
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
  ));
}

/** The saved hashtag sets found. */
function SnippetList({ snippets, onPick }: { snippets: ComposerSnippet[]; onPick: (text: string) => void }) {
  return (
    <ul className={styles.list} role="list">
      {snippets.map((s) => (
        <li key={s.id}>
          <button type="button" className={styles.option} onClick={() => onPick(s.text)}>
            <span className={styles.text}>
              <span className={styles.title}>{s.name}</span>
              <span className={styles.description}>{s.text}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Why no hashtag set shows: none matches the search, none in this batch, or none saved yet. */
function noSetsLine(q: string, query: string, more: boolean): string {
  if (q) return `No loaded set matches “${query.trim()}”.`;
  return more ? "None in this batch." : "No saved hashtag sets yet. Save one in Buffer or ask your AI.";
}

const readTemplates = (slotId: string) => (cursor?: string): Promise<Batch<ComposerTemplate>> =>
  readComposerTemplates(slotId, cursor).then((r) => (r.ok ? { ok: true, items: r.templates, more: r.more, cursor: r.cursor } : r));
const readSnippets = (slotId: string) => (cursor?: string): Promise<Batch<ComposerSnippet>> =>
  readComposerSnippets(slotId, cursor).then((r) => (r.ok ? { ok: true, items: r.snippets, more: r.more, cursor: r.cursor } : r));

/** Templates and Hashtags for one slot; `onInsert` receives the text to put into the post. */
export function ComposerLibrary({ slotId, onInsert, disabled = false }: { slotId: string; onInsert: (text: string, kind: "template" | "hashtags") => void; disabled?: boolean }) {
  const templates = usePagedList(readTemplates(slotId), "Buffer did not return the templates.", "Buffer did not return more templates.");
  const snippets = usePagedList(readSnippets(slotId), "Buffer did not return your hashtags.", "Buffer did not return more hashtags.");
  const [openList, setOpenList] = useState<"templates" | "hashtags" | null>(null);
  const [query, setQuery] = useState("");
  const search = useRef<HTMLInputElement>(null);

  const q = query.trim().toLowerCase();
  const t = templates.list, sn = snippets.list;
  const shownTemplates = useMemo(() => t.status === "done" ? t.items.filter((x) => `${x.title} ${x.description}`.toLowerCase().includes(q)) : [], [t, q]);
  const shownSnippets = useMemo(() => sn.status === "done" ? sn.items.filter((x) => `${x.name} ${x.text}`.toLowerCase().includes(q)) : [], [sn, q]);

  const pick = (text: string, kind: "template" | "hashtags") => { if (!disabled) onInsert(text, kind); setOpenList(null); };
  const opener = (list: "templates" | "hashtags") => (open: boolean) => {
    setOpenList(open ? list : null);
    if (!open) return;
    setQuery("");
    if (list === "templates") templates.load(); else snippets.load();
  };

  return (
    <div className={styles.bar}>
      <Popover open={openList === "templates"} onOpenChange={opener("templates")}>
        <PopoverTrigger asChild>
          <button type="button" className={styles.tool} disabled={disabled}><LayoutTemplate size={14} strokeWidth={1.8} aria-hidden="true" />Templates</button>
        </PopoverTrigger>
        <PopoverContent className={styles.panel} onOpenAutoFocus={(e) => { e.preventDefault(); search.current?.focus(); }}>
          <input ref={search} className={styles.search} placeholder="Search templates" aria-label="Search templates" value={query} maxLength={100} onChange={(e) => setQuery(e.target.value)} />
          <ListState list={t} loading="Loading templates…" />
          {t.status === "done" && shownTemplates.length === 0 && <>
            <p className={styles.muted}>{q ? `No loaded template matches “${query.trim()}”.` : "No templates yet."}</p>
            <MoreFooter list={t} onMore={templates.more} noun="templates" />
          </>}
          {t.status === "done" && shownTemplates.length > 0 && (
            <div className={styles.scroll}>
              <TemplateGroups templates={shownTemplates} onPick={(body) => pick(body, "template")} />
              <MoreFooter list={t} onMore={templates.more} noun="templates" />
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
          <ListState list={sn} loading="Loading your hashtags…" />
          {sn.status === "done" && shownSnippets.length === 0 && <>
            <p className={styles.muted}>{noSetsLine(q, query, sn.more)}</p>
            <MoreFooter list={sn} onMore={snippets.more} noun="sets" />
          </>}
          {sn.status === "done" && shownSnippets.length > 0 && (
            <div className={styles.scroll}>
              <SnippetList snippets={shownSnippets} onPick={(text) => pick(text, "hashtags")} />
              <MoreFooter list={sn} onMore={snippets.more} noun="sets" />
            </div>
          )}
        </PopoverContent>
      </Popover>
    </div>
  );
}
