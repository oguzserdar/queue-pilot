"use client";

import { Pager } from "./pager";
import { useRef, useState, useTransition } from "react";
import { cancelScheduledPostAction, changeScheduledPostAction, postTargets, resendPostAction, sendPostAction, type DirectPostView, type PostTargets, type SendPostResult } from "@/app/(app)/direct-post-actions";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/registry/components/popover/popover";
import { DatePicker } from "@/registry/components/date-picker/date-picker";
import { TimePicker } from "@/registry/components/time-picker/time-picker";
import { Button } from "@/registry/components/button/button";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { Textarea } from "@/registry/components/textarea/textarea";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { ChannelIcon } from "./channel-icon";
import { PLACE_NAMES, PlaceChips, type PlaceKind } from "./place-chips";
import styles from "./post-composer.module.css";

type Kind = PlaceKind;
const NAME = PLACE_NAMES;

/** A time as people read it, in their own time zone: "Sun 9 Nov, 18:00". */
export function when(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/**
 * The local date plus "HH:MM", as one moment in the browser's time zone. Returns null for a time that does not
 * exist that day (the clocks jump forward over it), rather than quietly moving it an hour.
 */
export function atLocal(day: Date, hhmm: string): Date | null {
  const [h, m] = hhmm.split(":").map(Number);
  const d = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0);
  return d.getHours() === h && d.getMinutes() === m && d.getDate() === day.getDate() ? d : null;
}

/** The same calendar day n days on, whatever the length of the days between (23 or 25 hours on clock changes). */
export function daysFrom(base: Date, n: number): Date {
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
}

/**
 * The UTC offset to show beside a time that happens twice that day (the clocks go back over it), e.g. "UTC−5";
 * null when the time happens once.
 */
export function repeatedOffset(at: Date): string | null {
  const same = (t: Date) => t.getHours() === at.getHours() && t.getMinutes() === at.getMinutes();
  if (!same(new Date(at.getTime() + 3_600_000)) && !same(new Date(at.getTime() - 3_600_000))) return null;
  const off = -at.getTimezoneOffset();
  const hh = Math.floor(Math.abs(off) / 60), mm = Math.abs(off) % 60;
  return `UTC${off < 0 ? "−" : "+"}${hh}${mm ? `:${String(mm).padStart(2, "0")}` : ""}`;
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
 * Write one post for Telegram and Discord, without a Buffer post: the places as chips at the top, one shared text
 * with a tab per place for different text, a live preview of what each place will show, and one button that sends
 * now or at the time picked beside it.
 */
export function PostComposer({ recent, pages, loadTargets = postTargets }: { recent: DirectPostView[]; pages?: { older: string | null; newer: string | null }; loadTargets?: () => Promise<PostTargets> }) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<PostTargets | null>(null);
  const [message, setMessage] = useState("");
  const [on, setOn] = useState<Record<Kind, boolean>>({ telegram: true, discord: true });
  const [own, setOwn] = useState<Record<Kind, string | null>>({ telegram: null, discord: null });
  const [tab, setTab] = useState<"all" | Kind>("all");
  const [channelId, setChannelId] = useState<string | null>(null);
  // The per-place text box, so "Write different text" can put the cursor at the end of the copied text.
  const ownBox = useRef<HTMLTextAreaElement>(null);
  const [result, setResult] = useState<SendPostResult | null>(null);
  // One key per composed post: every submit of this form reuses it, so a retry never posts twice.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [day, setDay] = useState<Date | undefined>(undefined);
  const [time, setTime] = useState("18:00");
  const [scheduled, setScheduled] = useState(false);
  const zone = typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  const [loading, startLoad] = useTransition();
  const [sending, startSend] = useTransition();
  const { toast } = useToastStack();

  const openComposer = () => {
    setOpen(true);
    setResult(null);
    startLoad(async () => {
      try {
        const t = await loadTargets();
        setTargets(t);
        setChannelId(t.discord?.defaultId ?? null);
      } catch {
        setTargets({ telegram: null, discord: null, problem: "Queue Pilot could not load your channels just now. Close this and try again." });
      }
    });
  };
  const reset = () => { setOpen(false); setMessage(""); setOwn({ telegram: null, discord: null }); setTab("all"); setScheduled(false); setDay(undefined); setKey(crypto.randomUUID()); };

  const places = (["telegram", "discord"] as const).filter((k) => targets?.[k]);
  const textFor = (k: Kind) => (own[k] ?? message).trim();
  const limitFor = (k: Kind) => targets?.[k]?.limit ?? 0;
  const chosen = places.filter((k) => on[k]);
  const channel = targets?.discord?.channels.find((c) => c.id === channelId);
  const sendAt = scheduled && day ? atLocal(day, time) : null;
  const missing = scheduled && !!day && !sendAt;
  const offset = sendAt ? repeatedOffset(sendAt) : null;
  const whenText = sendAt ? `${when(sendAt.toISOString())}${offset ? ` (${offset})` : ""}` : null;
  const problems = chosen.flatMap((k) => {
    const t = textFor(k);
    if (!t) return [`Write the ${NAME[k]} text.`];
    if (t.length > limitFor(k)) return [`The ${NAME[k]} text is ${t.length - limitFor(k)} characters too long.`];
    if (k === "discord" && !channel) return ["Pick a Discord channel Queue Pilot can post in."];
    return [];
  });
  if (missing) problems.push(`${time} does not exist that day: the clocks move forward. Pick another time.`);
  else if (scheduled && !sendAt) problems.push("Pick a day.");
  else if (sendAt && sendAt.getTime() <= Date.now() + 30_000) problems.push("Pick a time in the future.");
  const placeName = (k: Kind) => (k === "discord" && channel ? `#${channel.name}` : targets?.[k]?.label ?? NAME[k]);
  const action = !chosen.length ? "Choose a place" : whenText ? `Schedule for ${whenText}` : scheduled ? "Schedule" : `Send to ${chosen.map(placeName).join(" and ")}`;
  const quick = [
    { label: "This evening, 18:00", day: daysFrom(new Date(), 0), time: "18:00" },
    { label: "Tomorrow, 09:00", day: daysFrom(new Date(), 1), time: "09:00" },
  ].filter((q) => (atLocal(q.day, q.time)?.getTime() ?? 0) > Date.now() + 60_000);

  const send = () =>
    startSend(async () => {
      let r: SendPostResult;
      try {
        r = await sendPostAction({
          key,
          ...(sendAt ? { sendAt: sendAt.toISOString() } : {}),
          ...(on.telegram && targets?.telegram ? { telegram: { text: textFor("telegram") } } : {}),
          ...(on.discord && targets?.discord && channelId ? { discord: { channelId, text: textFor("discord") } } : {}),
        });
      } catch {
        // The form keeps its key, so pressing the button again never posts twice.
        r = { ok: false, message: "Queue Pilot did not answer, so it may have gone out. Press the button again: it will not post twice." };
      }
      setResult(r);
      if (r.ok && r.note) toast({ type: "info", title: r.note });
      else if (r.ok && r.results.every((x) => x.status === "sent")) toast({ type: "success", title: `Sent to ${r.results.map((x) => x.label).join(" and ")}.` });
      else if (r.ok && r.results.every((x) => x.status === "scheduled") && sendAt) toast({ type: "success", title: `Scheduled for ${when(sendAt.toISOString())}.` });
    });

  return (
    <>
      <div className={styles.bar}>
        <Button variant="secondary" size="md" onClick={openComposer}>Write a post</Button>
        <span className={styles.hint}>Post straight to your Telegram channel or a Discord channel, now or later, with no Buffer post needed.</span>
      </div>
      {recent.length > 0 && <Recent rows={recent} />}
      {pages && <Pager path="/settings" query={{ tab: "channels" }} older={pages.older} newer={pages.newer} label="Recent post pages" names={{ before: "postsBefore", after: "postsAfter" }} />}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={styles.dialog} title="New post" description="Telegram and Discord get exactly what the preview shows.">
          {loading || !targets ? (
            <p className={styles.hint}>Checking where Queue Pilot can post…</p>
          ) : result?.ok ? (
            <Results result={result} onDone={reset} />
          ) : places.length === 0 ? (
            <p className={styles.hint}>Connect a Telegram channel or add Queue Pilot to a Discord server first.{targets.problem ? ` ${targets.problem}` : ""}</p>
          ) : (
            <div className={styles.composer}>
              <PlaceChips places={places} on={on} onToggle={(k) => setOn((o) => ({ ...o, [k]: !o[k] }))} targets={targets} channelId={channelId} onChannel={setChannelId} />
              {targets.problem && <p className={styles.bad} role="alert">{targets.problem}</p>}

              <div className={styles.columns}>
                <div className={styles.write}>
                  <div className={styles.tabs} role="tablist" aria-label="Text">
                    {(["all", ...chosen] as const).map((t) => (
                      <button key={t} type="button" role="tab" aria-selected={tab === t} className={styles.tab} onClick={() => setTab(t)}>
                        {t === "all" ? "All places" : <><ChannelIcon service={t} size={14} />{NAME[t]}{own[t] !== null && <span className={styles.dot} aria-label="own text" />}</>}
                      </button>
                    ))}
                  </div>
                  {tab === "all" || !chosen.includes(tab) ? (
                    <Textarea label="Post" rows={9} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Patch 1.4 is out. Exports now resume after a dropped connection." />
                  ) : own[tab] === null ? (
                    <div className={styles.shared}>
                      <p className={styles.hint}>{NAME[tab]} uses the text from All places.</p>
                      <Button variant="secondary" size="sm" onClick={() => { setOwn((o) => ({ ...o, [tab]: message })); requestAnimationFrame(() => { const box = ownBox.current; if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length); } }); }}>Write different text for {NAME[tab]}</Button>
                    </div>
                  ) : (
                    <>
                      <Textarea ref={ownBox} label={`Text for ${NAME[tab]}`} rows={9} value={own[tab] ?? ""} onChange={(e) => setOwn((o) => ({ ...o, [tab]: e.target.value }))} />
                      <button type="button" className={styles.link} onClick={() => setOwn((o) => ({ ...o, [tab]: null }))}>Use the text from All places again</button>
                    </>
                  )}
                  <div className={styles.counts}>
                    {chosen.map((k) => {
                      const n = textFor(k).length;
                      return <span key={k} className={n > limitFor(k) ? styles.bad : styles.count}><ChannelIcon service={k} size={12} />{n.toLocaleString("en-GB")} / {limitFor(k).toLocaleString("en-GB")}</span>;
                    })}
                  </div>
                </div>

                <div className={styles.previews} aria-label="Preview">
                  {chosen.length === 0 && <p className={styles.hint}>Turn on a place to see its preview.</p>}
                  {chosen.includes("telegram") && (
                    <figure className={styles.tg}>
                      <figcaption className={styles.tgHead}><span className={styles.tgAvatar}>{(targets.telegram!.label[0] ?? "T").toUpperCase()}</span><span>{targets.telegram!.label}</span></figcaption>
                      <div className={styles.tgBubble}>
                        {textFor("telegram") ? <p className={styles.msg}>{textFor("telegram")}</p> : <p className={styles.empty}>Your post shows here.</p>}
                        <span className={styles.tgTime} suppressHydrationWarning>{sendAt ? time : "now"}</span>
                      </div>
                    </figure>
                  )}
                  {chosen.includes("discord") && (
                    <figure className={styles.dc}>
                      <figcaption className={styles.dcHead}># {channel?.name ?? "channel"}</figcaption>
                      <div className={styles.dcRow}>
                        <span className={styles.dcAvatar} aria-hidden="true">QP</span>
                        <div className={styles.dcBody}>
                          <p className={styles.dcName}>Queue Pilot <span className={styles.dcApp}>APP</span> <span className={styles.dcTime} suppressHydrationWarning>{sendAt ? when(sendAt.toISOString()) : "Today"}</span></p>
                          {textFor("discord") ? <p className={styles.msg}>{textFor("discord")}</p> : <p className={styles.empty}>Your post shows here.</p>}
                        </div>
                      </div>
                    </figure>
                  )}
                </div>
              </div>

              <div className={styles.footer}>
                <div className={styles.footLeft}>
                  {result && !result.ok && <p className={styles.bad} role="alert">{result.message}</p>}
                  {problems.length > 0 && chosen.length > 0 && <p className={styles.hint}>{problems[0]}</p>}
                  <p className={styles.zone}>Times are in {zone}.</p>
                </div>
                <div className={styles.footRight}>
                  <Popover>
                    <PopoverTrigger className={styles.whenButton} aria-label="When to send">
                      <span className={styles.whenLabel}>When</span>
                      <span suppressHydrationWarning>{whenText ?? (scheduled ? "Pick a day" : "Now")}</span> ▾
                    </PopoverTrigger>
                    <PopoverContent className={styles.whenPanel} align="end">
                      <PopoverClose asChild>
                        <button type="button" className={styles.menuItem} data-active={!scheduled || undefined} onClick={() => setScheduled(false)}><span>Now</span><span className={styles.menuNote}>Send as soon as you press the button</span></button>
                      </PopoverClose>
                      {quick.map((q) => (
                        <PopoverClose asChild key={q.label}>
                          <button type="button" className={styles.menuItem} onClick={() => { setScheduled(true); setDay(q.day); setTime(q.time); }}><span>{q.label}</span></button>
                        </PopoverClose>
                      ))}
                      <div className={styles.pick}>
                        <span className={styles.whenLabel}>Pick a day and time</span>
                        <div className={styles.whenRow}>
                          <DatePicker label="Day" side="top" value={day} onChange={(d) => { setDay(d); setScheduled(true); }} minDate={new Date(new Date().setHours(0, 0, 0, 0))} maxDate={new Date(Date.now() + 60 * 86_400_000)} showToday />
                          <TimePicker label="Time" value={time} onChange={(t) => { setTime(t); setScheduled(true); }} minuteStep={5} format="24h" />
                        </div>
                      </div>
                    </PopoverContent>
                  </Popover>
                  <Button variant="primary" size="md" loading={sending} disabled={!chosen.length || problems.length > 0} onClick={send}>{action}</Button>
                </div>
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
  const act = (fn: () => Promise<{ ok: true; note?: string } | { ok: false; message: string }>) => start(async () => {
    let x: { ok: true; note?: string } | { ok: false; message: string };
    try { x = await fn(); } catch { x = { ok: false, message: "Queue Pilot did not answer. Try again." }; }
    setNote(x.ok ? x.note ?? null : x.message);
    if (x.ok) { setEditing(null); setMoving(null); }
  });
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
            {r.followsBuffer && r.status === "scheduled" && <p className={styles.followNote}>Follows a Buffer post: change it on that draft in Next week.</p>}
            {r.status === "scheduled" && !r.followsBuffer && !editing && !moving && (
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
                <Button variant="primary" size="sm" loading={pending} disabled={!moving.day || !atLocal(moving.day, moving.time)} onClick={() => { const at = moving.day && atLocal(moving.day, moving.time); if (at) act(() => changeScheduledPostAction(r.postId, { sendAt: at.toISOString() })); }}>Save time</Button>
              </div>
            )}
            {r.link && <a className={styles.link} href={r.link} target="_blank" rel="noopener noreferrer">Open the message</a>}
            {r.status === "failed" && !r.followsBuffer && (
              <Button variant="ghost" size="sm" loading={pending} onClick={() => act(() => resendPostAction(r.postId, r.kind))}>Send again</Button>
            )}
          </li>
        ))}
      </ul>
      {note && <p className={styles.bad} role="alert">{note}</p>}
    </div>
  );
}
