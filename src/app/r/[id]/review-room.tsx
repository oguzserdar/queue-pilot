"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/registry/components/button/button";
import { Input } from "@/registry/components/input/input";
import { Textarea } from "@/registry/components/textarea/textarea";
import { NETWORKS } from "@/lib/rules";
import { MAX_COMMENT, MAX_NAME, type ReviewComment, type SharedDraft } from "@/lib/review-limits";
import { addReviewComment } from "./actions";
import { LocalTime } from "@/components/local-time";
import styles from "./review.module.css";

const NAME_KEY = "qp-review-name";

/** Where a selection starts and ends inside one draft's text, or null when it is empty or leaves the draft. */
function selectionIn(el: HTMLElement): { start: number; end: number; rect: DOMRect } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const end = start + range.toString().length;
  return end > start ? { start, end, rect: range.getBoundingClientRect() } : null;
}

const WHEN: Intl.DateTimeFormatOptions = { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };
const AGO: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" };

/** The draft's text with every commented span marked; the active comment's span is emphasised. */
function Marked({ text, comments, active, onPick }: { text: string; comments: ReviewComment[]; active: string | null; onPick: (id: string) => void }) {
  const spans = comments.filter((c) => c.start !== null && c.end !== null && c.end! <= text.length).sort((a, b) => a.start! - b.start!);
  const parts: React.ReactNode[] = [];
  let at = 0;
  for (const c of spans) {
    if (c.start! < at) continue;
    parts.push(text.slice(at, c.start!));
    parts.push(<mark key={c.id} className={styles.hl} data-active={active === c.id} onClick={() => onPick(c.id)} onMouseEnter={() => onPick(c.id)}>{text.slice(c.start!, c.end!)}</mark>);
    at = c.end!;
  }
  parts.push(text.slice(at));
  return <>{parts}</>;
}

/** The public review page: each shared draft beside its comments; select words for a floating Comment button. */
export function ReviewRoom({ id, drafts, initial }: { id: string; drafts: SharedDraft[]; initial: ReviewComment[] }) {
  const [comments, setComments] = useState(initial);
  const [floating, setFloating] = useState<{ postId: string; start: number; end: number; top: number; left: number } | null>(null);
  const [target, setTarget] = useState<{ postId: string; start?: number; end?: number } | null>(null);
  const [name, setName] = useState("");
  const [savedName, setSavedName] = useState("");
  const [text, setText] = useState("");
  const [active, setActive] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string; postId: string } | null>(null);
  const [pending, start] = useTransition();
  const texts = useRef(new Map<string, HTMLParagraphElement>());

  // The name is remembered on this device only, so a reviewer types it once.
  useEffect(() => { try { const n = localStorage.getItem(NAME_KEY) ?? ""; setName(n); setSavedName(n); } catch {} }, []);
  // The floating button goes away when the selection does.
  useEffect(() => {
    const clear = () => { const s = window.getSelection(); if (!s || s.isCollapsed) setFloating(null); };
    document.addEventListener("selectionchange", clear);
    return () => document.removeEventListener("selectionchange", clear);
  }, []);

  const pick = (postId: string) => {
    const el = texts.current.get(postId);
    const span = el ? selectionIn(el) : null;
    if (!span) return;
    setFloating({ postId, start: span.start, end: span.end, top: span.rect.top + window.scrollY - 44, left: Math.max(8, Math.min(window.innerWidth - 120, span.rect.left + window.scrollX + span.rect.width / 2 - 52)) });
  };
  const compose = (t: { postId: string; start?: number; end?: number }) => { setTarget(t); setFloating(null); setMessage(null); window.getSelection()?.removeAllRanges(); };

  const send = () => start(async () => {
    if (!target) return;
    try { localStorage.setItem(NAME_KEY, name.trim()); } catch {}
    const r = await addReviewComment(id, { postId: target.postId, name, text, start: target.start, end: target.end });
    if (!r.ok) { setMessage({ ok: false, text: r.message, postId: target.postId }); return; }
    setComments(r.comments);
    setSavedName(name.trim());
    setText("");
    setMessage({ ok: true, text: "Sent. Comments can't be edited after sending.", postId: target.postId });
    setTarget(null);
  });

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.mark}>Queue Pilot<span>.</span></p>
        <h1 className={styles.title}>{`Review ${drafts.length} draft${drafts.length === 1 ? "" : "s"}`}</h1>
        <p className={styles.sub}>Select any words to comment on them, or comment on a whole draft. Comments go only to the person who shared this link. Nothing here gets posted.</p>
      </header>

      {floating && (
        <button type="button" className={styles.floating} style={{ top: floating.top, left: floating.left }} onMouseDown={(e) => e.preventDefault()} onClick={() => compose({ postId: floating.postId, start: floating.start, end: floating.end })}>
          Comment
        </button>
      )}

      <ol className={styles.drafts}>
        {drafts.map((d, i) => {
          const mine = comments.filter((c) => c.postId === d.postId).sort((a, b) => (a.start ?? Infinity) - (b.start ?? Infinity));
          const quote = target?.postId === d.postId && target.start !== undefined ? d.text.slice(target.start, target.end) : null;
          return (
            <li key={d.postId} className={styles.draft}>
              <article className={styles.post}>
                <p className={styles.meta}><span className={styles.num}>{i + 1}</span><strong>{NETWORKS[d.network] ?? d.network}</strong> · {d.channel} · <LocalTime iso={d.dueAt} options={WHEN} fallback="No time set" /></p>
                <p className={styles.text} ref={(el) => { if (el) texts.current.set(d.postId, el); }} onMouseUp={() => pick(d.postId)} onKeyUp={() => pick(d.postId)} onTouchEnd={() => setTimeout(() => pick(d.postId), 0)} tabIndex={0} aria-label={`Draft ${i + 1}. Select words to comment on them.`}>
                  <Marked text={d.text} comments={mine} active={active} onPick={setActive} />
                </p>
              </article>
              <aside className={styles.side} aria-label={`Comments on draft ${i + 1}`}>
                {mine.length === 0 && target?.postId !== d.postId && <p className={styles.empty}>No comments yet.</p>}
                {mine.length > 0 && (
                  <ul className={styles.comments}>
                    {mine.map((c) => (
                      <li key={c.id} className={styles.comment} data-active={active === c.id} onMouseEnter={() => setActive(c.id)} onMouseLeave={() => setActive(null)}>
                        <span className={styles.who}><span className={styles.avatar} aria-hidden="true">{c.name.trim().charAt(0).toUpperCase()}</span>{c.name}<span className={styles.time}><LocalTime iso={c.createdAt} options={AGO} /></span></span>
                        {c.quote && <q className={styles.quote}>{c.quote}</q>}
                        <span className={styles.body}>{c.text}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {target?.postId === d.postId ? (
                  <form className={styles.form} onSubmit={(e) => { e.preventDefault(); send(); }}>
                    <p className={styles.on}>{quote ? <>On <q className={styles.quote}>{quote}</q></> : "On the whole draft"}</p>
                    {savedName ? (
                      <p className={styles.as}>Commenting as <strong>{savedName}</strong> <button type="button" className={styles.link} onClick={() => setSavedName("")}>Change</button></p>
                    ) : (
                      <Input label="Your name" description="Shown with your comment." value={name} maxLength={MAX_NAME} onChange={(e) => setName(e.target.value)} disabled={pending} />
                    )}
                    <Textarea label="Comment" value={text} maxLength={MAX_COMMENT} onChange={(e) => setText(e.target.value)} disabled={pending} autoFocus placeholder={quote ? "What should change here?" : "What do you think of this draft?"} />
                    <div className={styles.actions}>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setTarget(null)} disabled={pending}>Cancel</Button>
                      <Button type="submit" variant="primary" size="sm" disabled={pending || !name.trim() || !text.trim()}>{pending ? "Sending…" : "Send comment"}</Button>
                    </div>
                  </form>
                ) : (
                  <Button variant="secondary" size="sm" className={styles.add} onClick={() => compose({ postId: d.postId })}>Comment on this draft</Button>
                )}
                {message?.postId === d.postId && <p className={message.ok ? styles.ok : styles.error} role="status">{message.text}</p>}
              </aside>
            </li>
          );
        })}
      </ol>
    </main>
  );
}
