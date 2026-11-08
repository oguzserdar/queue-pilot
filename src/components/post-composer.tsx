"use client";

import { useState, useTransition } from "react";
import { cancelScheduledPostAction, changeScheduledPostAction, postTargets, resendPostAction, sendPostAction, type DirectPostView, type PostTargets, type SendPostResult } from "@/app/(app)/direct-post-actions";
import SegmentedControl from "@/registry/components/segmented-control/segmented-control";
import { DatePicker } from "@/registry/components/date-picker/date-picker";
import { TimePicker } from "@/registry/components/time-picker/time-picker";
import { Button } from "@/registry/components/button/button";
import { Checkbox } from "@/registry/components/checkbox/checkbox";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { Select } from "@/registry/components/select/select";
import { Textarea } from "@/registry/components/textarea/textarea";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { ChannelIcon } from "./channel-icon";
import styles from "./post-composer.module.css";

type Kind = "telegram" | "discord";
const NAME: Record<Kind, string> = { telegram: "Telegram", discord: "Discord" };

/** A time as people read it, in their own time zone: "Sun 9 Nov, 18:00". */
export function when(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** The local date plus "HH:MM", as one moment; the browser applies its own time zone and daylight saving. */
export function atLocal(day: Date, hhmm: string): Date {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
}

/** How one result reads: landed with a link, refused with Telegram's or Discord's reason, or may have landed. */
export function resultWords(r: { status: string; error: string | null; sendAt?: string | null; late?: boolean }): string {
  if (r.status === "scheduled") return r.sendAt ? `Scheduled for ${when(r.sendAt)}` : "Scheduled";
  if (r.status === "cancelled") return "Cancelled";
  if (r.status === "sent") return r.late && r.sendAt ? `Sent late (it was due ${when(r.sendAt)})` : "Sent";
  if (r.status === "failed") return `Not sent: ${r.error ?? "refused"}`;
  if (r.status === "pending") return "Sending";
  return "No answer in time, so it may have been sent. Check the channel before sending it again.";
}

/**
 * Write one post and send it to the person's Telegram channel and/or Discord channel on its own, without a
 * Buffer post. Each place shows exactly what it will receive, can carry its own text, and reports its own result.
 */
export function PostComposer({ recent, loadTargets = postTargets }: { recent: DirectPostView[]; loadTargets?: () => Promise<PostTargets> }) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<PostTargets | null>(null);
  const [message, setMessage] = useState("");
  const [on, setOn] = useState<Record<Kind, boolean>>({ telegram: true, discord: true });
  const [own, setOwn] = useState<Record<Kind, string | null>>({ telegram: null, discord: null });
  const [channelId, setChannelId] = useState<string | null>(null);
  const [result, setResult] = useState<SendPostResult | null>(null);
  // One key per composed post: every submit of this form reuses it, so a retry never posts twice.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [timing, setTiming] = useState<"now" | "later">("now");
  const [day, setDay] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState("18:00");
  const zone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  const [loading, startLoad] = useTransition();
  const [sending, startSend] = useTransition();
  const { toast } = useToastStack();

  const openComposer = () => {
    setOpen(true);
    setResult(null);
    startLoad(async () => {
      const t = await loadTargets();
      setTargets(t);
      setChannelId(t.discord?.defaultId ?? null);
    });
  };

  const places = (["telegram", "discord"] as const).filter((k) => targets?.[k]);
  const textFor = (k: Kind) => (own[k] ?? message).trim();
  const limitFor = (k: Kind) => targets?.[k]?.limit ?? 0;
  const chosen = places.filter((k) => on[k]);
  const channelName = targets?.discord?.channels.find((c) => c.id === channelId)?.name;
  const problems = chosen.flatMap((k) => {
    const t = textFor(k);
    if (!t) return [`The ${NAME[k]} message is empty.`];
    if (t.length > limitFor(k)) return [`The ${NAME[k]} message is ${t.length} characters; ${NAME[k]} takes up to ${limitFor(k)}.`];
    if (k === "discord" && !channelName) return ["Pick a Discord channel Queue Pilot can post in."];
    return [];
  });
  const sendAt = timing === "later" && day ? atLocal(day, time) : null;
  if (timing === "later") {
    if (!sendAt) problems.push("Pick a day to send it.");
    else if (sendAt.getTime() <= Date.now() + 30_000) problems.push("Pick a time in the future.");
  }
  const where = chosen.map((k) => (k === "discord" && channelName ? `#${channelName}` : NAME[k])).join(" and ");
  const sendLabel = timing === "later" ? (sendAt ? `Schedule for ${when(sendAt.toISOString())}` : "Schedule") : `Send to ${where}`;

  const send = () =>
    startSend(async () => {
      const r = await sendPostAction({
        key,
        ...(timing === "later" && sendAt ? { sendAt: sendAt.toISOString() } : {}),
        ...(on.telegram && targets?.telegram ? { telegram: { text: textFor("telegram") } } : {}),
        ...(on.discord && targets?.discord && channelId ? { discord: { channelId, text: textFor("discord") } } : {}),
      });
      setResult(r);
      if (r.ok && r.results.every((x) => x.status === "sent")) toast({ type: "success", title: `Sent to ${r.results.map((x) => x.label).join(" and ")}.` });
      if (r.ok && r.results.every((x) => x.status === "scheduled") && sendAt) toast({ type: "success", title: `Scheduled for ${when(sendAt.toISOString())}.` });
    });

  return (
    <>
      <div className={styles.bar}>
        <Button variant="secondary" size="md" onClick={openComposer}>Write a post</Button>
        <span className={styles.hint}>Post straight to your Telegram channel or a Discord channel, with no Buffer post needed.</span>
      </div>
      {recent.length > 0 && <Recent rows={recent} />}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent title="Write a post" description="Each place gets exactly the text shown under it.">
          {loading || !targets ? (
            <p className={styles.hint}>Checking where Queue Pilot can post…</p>
          ) : result?.ok ? (
            <Results result={result} onDone={() => { setOpen(false); setMessage(""); setOwn({ telegram: null, discord: null }); setKey(crypto.randomUUID()); }} />
          ) : places.length === 0 ? (
            <p className={styles.hint}>Connect a Telegram channel or add Queue Pilot to a Discord server first.{targets.problem ? ` ${targets.problem}` : ""}</p>
          ) : (
            <div className={styles.form}>
              <Textarea label="Post" rows={5} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Patch 1.4 is out. Exports now resume after a dropped connection." />
              {targets.problem && <p className={styles.bad} role="alert">{targets.problem}</p>}
              {places.map((k) => {
                const text = textFor(k);
                const over = text.length > limitFor(k);
                return (
                  <section key={k} className={styles.place} data-off={!on[k] || undefined} aria-label={NAME[k]}>
                    <div className={styles.placeHead}>
                      <Checkbox checked={on[k]} onCheckedChange={(v) => setOn({ ...on, [k]: v === true })} label={`${NAME[k]} · ${targets[k]!.label}`} />
                      <ChannelIcon service={k} size={18} />
                    </div>
                    {on[k] && (
                      <>
                        {k === "discord" && targets.discord && (
                          <Select label="Channel" value={channelId ?? undefined} onValueChange={setChannelId} placeholder="Pick a channel"
                            options={targets.discord.channels.map((c) => ({ value: c.id, label: c.canPost ? `#${c.name}` : `#${c.name} (Queue Pilot cannot post here)`, disabled: !c.canPost }))} />
                        )}
                        {own[k] === null ? (
                          <button type="button" className={styles.link} onClick={() => setOwn({ ...own, [k]: message })}>Write different text for {NAME[k]}</button>
                        ) : (
                          <Textarea label={`Text for ${NAME[k]}`} rows={4} value={own[k] ?? ""} onChange={(e) => setOwn({ ...own, [k]: e.target.value })} />
                        )}
                        <div className={styles.preview} data-kind={k} aria-label={`What ${NAME[k]} will show`}>{text || <span className={styles.hint}>Nothing written yet.</span>}</div>
                        <span className={over ? styles.bad : styles.count}>{text.length} / {limitFor(k)}</span>
                      </>
                    )}
                  </section>
                );
              })}
              <div className={styles.timing}>
                <SegmentedControl label="When" value={timing} onValueChange={(v) => setTiming(v === "later" ? "later" : "now")} options={[{ value: "now", label: "Send now" }, { value: "later", label: "Send later" }]} />
                {timing === "later" && (
                  <div className={styles.whenRow}>
                    <DatePicker label="Day" value={day} onChange={setDay} minDate={new Date(new Date().setHours(0, 0, 0, 0))} maxDate={new Date(Date.now() + 60 * 86_400_000)} showToday />
                    <TimePicker label="Time" value={time} onChange={setTime} minuteStep={5} format="24h" />
                    <span className={styles.hint}>Your time zone: {zone}</span>
                  </div>
                )}
              </div>
              {result && !result.ok && <p className={styles.bad} role="alert">{result.message}</p>}
              {problems.length > 0 && chosen.length > 0 && <p className={styles.hint}>{problems[0]}</p>}
              <div className={styles.foot}>
                <Button variant="ghost" size="md" onClick={() => setOpen(false)}>Cancel</Button>
                <Button variant="primary" size="md" loading={sending} disabled={!chosen.length || problems.length > 0} onClick={send}>{chosen.length ? sendLabel : "Choose a place"}</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Results({ result, onDone }: { result: Extract<SendPostResult, { ok: true }>; onDone: () => void }) {
  return (
    <div className={styles.form}>
      <ul className={styles.results}>
        {result.results.map((r) => (
          <li key={r.kind} className={styles.result} data-status={r.status}>
            <strong className={styles.brand}><ChannelIcon service={r.kind} size={16} />{r.label}</strong>
            <span>{resultWords(r)}</span>
            {r.link && <a className={styles.link} href={r.link} target="_blank" rel="noopener noreferrer">Open the message</a>}
          </li>
        ))}
      </ul>
      <div className={styles.foot}><Button variant="primary" size="md" onClick={onDone}>Done</Button></div>
    </div>
  );
}

/**
 * The last direct posts, each place with its result. A refused place can be sent again; a scheduled post can be
 * cancelled, moved to another time, or have its text changed before it goes out.
 */
function Recent({ rows }: { rows: DirectPostView[] }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  const [editing, setEditing] = useState<{ postId: string; kind: Kind; text: string } | null>(null);
  const [moving, setMoving] = useState<{ postId: string; day: Date | undefined; time: string } | null>(null);
  const firstOfPost = (i: number) => rows.findIndex((x) => x.postId === rows[i].postId) === i;
  const act = (fn: () => Promise<{ ok: true } | { ok: false; message: string }>) => start(async () => { const x = await fn(); setNote(x.ok ? null : x.message); if (x.ok) { setEditing(null); setMoving(null); } });
  return (
    <div className={styles.recent}>
      <h3 className={styles.recentTitle}>Recent posts</h3>
      <ul className={[styles.results, styles.recentList].join(" ")}>
        {rows.map((r, i) => (
          <li key={`${r.postId}-${r.kind}`} className={styles.result} data-status={r.status}>
            <strong className={styles.brand}><ChannelIcon service={r.kind} size={16} />{r.label}</strong>
            {editing?.postId === r.postId && editing.kind === r.kind ? (
              <div className={styles.form}>
                <Textarea label={`Text for ${NAME[r.kind]}`} rows={3} value={editing.text} onChange={(e) => setEditing({ ...editing, text: e.target.value })} />
                <div className={styles.foot}>
                  <Button variant="ghost" size="sm" onClick={() => setEditing(null)}>Keep the old text</Button>
                  <Button variant="primary" size="sm" loading={pending} onClick={() => act(() => changeScheduledPostAction(r.postId, { [r.kind]: editing.text }))}>Save text</Button>
                </div>
              </div>
            ) : (
              <span className={styles.excerpt}>{r.text}</span>
            )}
            <span suppressHydrationWarning>{resultWords(r)}</span>
            {r.status === "scheduled" && !editing && !moving && (
              <div className={styles.rowActions}>
                <Button variant="ghost" size="sm" onClick={() => setEditing({ postId: r.postId, kind: r.kind, text: r.text })}>Edit text</Button>
                {firstOfPost(i) && <Button variant="ghost" size="sm" onClick={() => setMoving({ postId: r.postId, day: r.sendAt ? new Date(r.sendAt) : undefined, time: r.sendAt ? new Date(r.sendAt).toTimeString().slice(0, 5) : "18:00" })}>Change time</Button>}
                {firstOfPost(i) && <Button variant="ghost" size="sm" loading={pending} onClick={() => act(() => cancelScheduledPostAction(r.postId))}>Cancel post</Button>}
              </div>
            )}
            {moving?.postId === r.postId && firstOfPost(i) && (
              <div className={styles.whenRow}>
                <DatePicker label="Day" value={moving.day} onChange={(d) => setMoving({ ...moving, day: d })} minDate={new Date(new Date().setHours(0, 0, 0, 0))} maxDate={new Date(Date.now() + 60 * 86_400_000)} />
                <TimePicker label="Time" value={moving.time} onChange={(t) => setMoving({ ...moving, time: t })} minuteStep={5} format="24h" />
                <Button variant="ghost" size="sm" onClick={() => setMoving(null)}>Keep the time</Button>
                <Button variant="primary" size="sm" loading={pending} disabled={!moving.day} onClick={() => moving.day && act(() => changeScheduledPostAction(r.postId, { sendAt: atLocal(moving.day!, moving.time).toISOString() }))}>Save time</Button>
              </div>
            )}
            {r.link && <a className={styles.link} href={r.link} target="_blank" rel="noopener noreferrer">Open the message</a>}
            {r.status === "failed" && (
              <Button variant="ghost" size="sm" loading={pending} onClick={() => start(async () => { const x = await resendPostAction(r.postId, r.kind); setNote(x.ok ? null : x.message); })}>Send again</Button>
            )}
          </li>
        ))}
      </ul>
      {note && <p className={styles.bad} role="alert">{note}</p>}
    </div>
  );
}
