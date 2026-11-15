"use client";

/**
 * The last direct posts, each place with its result. A refused place can be sent again; a scheduled post can be
 * cancelled, moved to another time, or have its text changed before it goes out.
 */
import { useState, useTransition } from "react";
import { cancelScheduledPostAction, changeScheduledPostAction, resendPostAction, type DirectPostView } from "@/app/(app)/direct-post-actions";
import type { PostKind } from "@/lib/direct-posts";
import { atLocal, daysFrom, resultWords } from "@/lib/post-time";
import { Button } from "@/registry/components/button/button";
import { DatePicker } from "@/registry/components/date-picker/date-picker";
import { Textarea } from "@/registry/components/textarea/textarea";
import { TimePicker } from "@/registry/components/time-picker/time-picker";
import { ChannelIcon } from "./channel-icon";
import { PLACE_NAMES } from "./place-chips";
import styles from "./post-composer.module.css";

type Outcome = { ok: true; note?: string } | { ok: false; message: string };
/** A time being changed: the post, the picked day and time, and the moment the change started (ms). */
type Moving = { postId: string; day: Date | undefined; time: string; now: number };

/** "HH:MM" of an ISO time in the reader's zone, or the default evening time. */
const timeOf = (iso: string | null) => (iso ? new Date(iso).toTimeString().slice(0, 5) : "18:00");

export function RecentPosts({ rows }: { rows: DirectPostView[] }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ postId: string; kind: PostKind; text: string } | null>(null);
  const [moving, setMoving] = useState<Moving | null>(null);
  const firstOfPost = (i: number) => rows.findIndex((x) => x.postId === rows[i]?.postId) === i;
  const act = (fn: () => Promise<Outcome>) => start(async () => {
    const x = await fn().catch((): Outcome => ({ ok: false, message: "Queue Pilot did not answer. Try again." }));
    setNote(x.ok ? x.note ?? null : x.message);
    if (x.ok) { setEditing(null); setMoving(null); }
  });
  return (
    <div className={styles.recent}>
      <h3 className={styles.recentTitle}>Recent posts</h3>
      <ul className={[styles.results, styles.recentList].join(" ")}>
        {rows.map((r, i) => (
          <li key={`${r.postId}-${r.kind}-${r.target}`} className={styles.result} data-status={r.status}>
            <strong className={styles.brand}><ChannelIcon service={r.kind} size={16} />{r.label}</strong>
            {editing?.postId === r.postId && editing.kind === r.kind ? (
              <div className={styles.form}>
                <Textarea label={`Text for ${PLACE_NAMES[r.kind]}`} rows={3} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
                <div className={styles.foot}>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Keep the old text</Button>
                  <Button variant="primary" size="sm" loading={pending} onClick={() => act(() => changeScheduledPostAction(r.postId, { [r.kind]: editing.text }))}>Save text</Button>
                </div>
              </div>
            ) : <span className={styles.excerpt}>{r.text}</span>}
            <span suppressHydrationWarning>{resultWords(r)}</span>
            {r.followsBuffer && r.status === "scheduled" && <p className={styles.followNote}>Follows a Buffer post: change it on that draft in Next week.</p>}
            {r.status === "scheduled" && !r.followsBuffer && !editing && !moving && (
              <div className={styles.rowActions}>
                <Button variant="ghost" size="sm" onClick={() => setEditing({ postId: r.postId, kind: r.kind, text: r.text })}>Edit text</Button>
                {firstOfPost(i) && <Button variant="ghost" size="sm" onClick={() => setMoving({ postId: r.postId, day: r.sendAt ? new Date(r.sendAt) : undefined, time: timeOf(r.sendAt), now: Date.now() })}>Change time</Button>}
                {firstOfPost(i) && <Button variant="ghost" size="sm" loading={pending} onClick={() => act(() => cancelScheduledPostAction(r.postId))}>Cancel post</Button>}
              </div>
            )}
            {moving?.postId === r.postId && firstOfPost(i) && <MoveTime moving={moving} pending={pending} onChange={setMoving} onSave={(at) => act(() => changeScheduledPostAction(r.postId, { sendAt: at.toISOString() }))} />}
            {r.link && <a className={styles.link} href={r.link} target="_blank" rel="noopener noreferrer">Open the message</a>}
            {r.status === "failed" && !r.followsBuffer && (
              <Button variant="ghost" size="sm" loading={pending} onClick={() => act(() => resendPostAction(r.postId, r.kind, r.target))}>Send again</Button>
            )}
          </li>
        ))}
      </ul>
      {note && <p className={styles.bad} role="alert">{note}</p>}
    </div>
  );
}

/** The day and time pickers for moving one scheduled post. */
function MoveTime({ moving, pending, onChange, onSave }: { moving: Moving; pending: boolean; onChange: (m: Moving | null) => void; onSave: (at: Date) => void }) {
  const at = moving.day ? atLocal(moving.day, moving.time) : null;
  const today = new Date(moving.now);
  return (
    <div className={styles.whenRow}>
      <DatePicker label="Day" value={moving.day} onChange={(d) => onChange({ ...moving, day: d })} minDate={daysFrom(today, 0)} maxDate={daysFrom(today, 60)} />
      <TimePicker label="Time" value={moving.time} onChange={(t) => onChange({ ...moving, time: t })} minuteStep={5} format="24h" />
      <Button variant="ghost" size="sm" onClick={() => onChange(null)}>Keep the time</Button>
      <Button variant="primary" size="sm" loading={pending} disabled={!at} onClick={() => { if (at) onSave(at); }}>Save time</Button>
    </div>
  );
}
