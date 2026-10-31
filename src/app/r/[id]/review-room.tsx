"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Button } from "@/registry/components/button/button";
import { Input } from "@/registry/components/input/input";
import { Textarea } from "@/registry/components/textarea/textarea";
import { NETWORKS } from "@/lib/rules";
import { MAX_COMMENT, MAX_NAME, type ReviewComment, type SharedDraft } from "@/lib/review-limits";
import { addReviewComment } from "./actions";
import styles from "./review.module.css";

const NAME_KEY = "qp-review-name";

/** Where a selection starts and ends inside one draft's text, or null when it is empty or leaves the draft. */
function selectionIn(el: HTMLElement): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer) || !el.contains(range.endContainer)) return null;
  const before = document.createRange();
  before.selectNodeContents(el);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const end = start + range.toString().length;
  return end > start ? { start, end } : null;
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }) : "No time set");

/** The public review page: the shared drafts, their comments, and a form to comment on highlighted words. */
export function ReviewRoom({ id, drafts, initial }: { id: string; drafts: SharedDraft[]; initial: ReviewComment[] }) {
  const [comments, setComments] = useState(initial);
  const [target, setTarget] = useState<{ postId: string; start?: number; end?: number } | null>(null);
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const texts = useRef(new Map<string, HTMLParagraphElement>());

  // The name is remembered on this device only, so a reviewer types it once.
  useEffect(() => { try { setName(localStorage.getItem(NAME_KEY) ?? ""); } catch {} }, []);

  const pick = (postId: string) => {
    const el = texts.current.get(postId);
    const span = el ? selectionIn(el) : null;
    if (span) { setTarget({ postId, ...span }); setMessage(null); }
  };

  const send = () => start(async () => {
    if (!target) return;
    try { localStorage.setItem(NAME_KEY, name.trim()); } catch {}
    const r = await addReviewComment(id, { postId: target.postId, name, text, start: target.start, end: target.end });
    if (!r.ok) { setMessage({ ok: false, text: r.message }); return; }
    setComments(r.comments);
    setText("");
    setTarget(null);
    setMessage({ ok: true, text: "Comment added." });
  });

  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <p className={styles.mark}>Queue Pilot<span>.</span></p>
        <h1 className={styles.title}>{`Review ${drafts.length} draft${drafts.length === 1 ? "" : "s"}`}</h1>
        <p className={styles.sub}>Highlight words in a draft to comment on them, or comment on the whole draft. Your comments go to the person who shared this link. Nothing here is posted.</p>
      </header>
      <ol className={styles.drafts}>
        {drafts.map((d) => {
          const mine = comments.filter((c) => c.postId === d.postId);
          const quote = target?.postId === d.postId && target.start !== undefined ? d.text.slice(target.start, target.end) : null;
          return (
            <li key={d.postId} className={styles.draft}>
              <p className={styles.meta}><strong>{NETWORKS[d.network] ?? d.network}</strong> · {d.channel} · <span className="tnum">{when(d.dueAt)}</span></p>
              <p className={styles.text} ref={(el) => { if (el) texts.current.set(d.postId, el); }} onMouseUp={() => pick(d.postId)} onKeyUp={() => pick(d.postId)} tabIndex={0}>{d.text}</p>
              {mine.length > 0 && (
                <ul className={styles.comments} aria-label="Comments">
                  {mine.map((c) => (
                    <li key={c.id} className={styles.comment}>
                      <span className={styles.who}>{c.name}</span>
                      {c.quote && <q className={styles.quote}>{c.quote}</q>}
                      <span className={styles.body}>{c.text}</span>
                    </li>
                  ))}
                </ul>
              )}
              {target?.postId === d.postId ? (
                <form className={styles.form} onSubmit={(e) => { e.preventDefault(); send(); }}>
                  <p className={styles.on}>{quote ? <>On <q className={styles.quote}>{quote}</q></> : "On the whole draft"}</p>
                  <Input label="Your name" value={name} maxLength={MAX_NAME} onChange={(e) => setName(e.target.value)} disabled={pending} />
                  <Textarea label="Comment" value={text} maxLength={MAX_COMMENT} onChange={(e) => setText(e.target.value)} disabled={pending} autoFocus />
                  <div className={styles.actions}>
                    <Button type="button" variant="ghost" onClick={() => setTarget(null)} disabled={pending}>Cancel</Button>
                    <Button type="submit" variant="primary" disabled={pending || !name.trim() || !text.trim()}>{pending ? "Sending…" : "Add comment"}</Button>
                  </div>
                </form>
              ) : (
                <Button variant="secondary" size="sm" className={styles.add} onClick={() => { setTarget({ postId: d.postId }); setMessage(null); }}>Comment on this draft</Button>
              )}
            </li>
          );
        })}
      </ol>
      {message && <p className={message.ok ? styles.ok : styles.error} role="status">{message.text}</p>}
    </main>
  );
}
