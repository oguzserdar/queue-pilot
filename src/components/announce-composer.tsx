"use client";

import { useState, useTransition } from "react";
import { announceTargets, resendAnnouncementAction, sendAnnouncementAction, type AnnounceRowView, type AnnounceTargets, type SendAnnouncementResult } from "@/app/(app)/announce-actions";
import { Button } from "@/registry/components/button/button";
import { Checkbox } from "@/registry/components/checkbox/checkbox";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { Select } from "@/registry/components/select/select";
import { Textarea } from "@/registry/components/textarea/textarea";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { ChannelIcon } from "./channel-icon";
import styles from "./announce-composer.module.css";

type Kind = "telegram" | "discord";
const NAME: Record<Kind, string> = { telegram: "Telegram", discord: "Discord" };

/** How one result reads: landed with a link, refused with Telegram's or Discord's reason, or may have landed. */
export function resultWords(r: { status: string; error: string | null }): string {
  if (r.status === "sent") return "Sent";
  if (r.status === "failed") return `Not sent: ${r.error ?? "refused"}`;
  if (r.status === "pending") return "Sending";
  return "No answer in time, so it may have been sent. Check the channel before sending it again.";
}

/**
 * Write one announcement and send it to the person's Telegram channel and/or Discord channel on its own, without a
 * Buffer post. Each place shows exactly what it will receive, can carry its own text, and reports its own result.
 */
export function AnnounceComposer({ recent, loadTargets = announceTargets }: { recent: AnnounceRowView[]; loadTargets?: () => Promise<AnnounceTargets> }) {
  const [open, setOpen] = useState(false);
  const [targets, setTargets] = useState<AnnounceTargets | null>(null);
  const [message, setMessage] = useState("");
  const [on, setOn] = useState<Record<Kind, boolean>>({ telegram: true, discord: true });
  const [own, setOwn] = useState<Record<Kind, string | null>>({ telegram: null, discord: null });
  const [channelId, setChannelId] = useState<string | null>(null);
  const [result, setResult] = useState<SendAnnouncementResult | null>(null);
  // One key per composed announcement: every submit of this form reuses it, so a retry never posts twice.
  const [key, setKey] = useState(() => crypto.randomUUID());
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
  const sendLabel = `Send to ${chosen.map((k) => (k === "discord" && channelName ? `#${channelName}` : NAME[k])).join(" and ")}`;

  const send = () =>
    startSend(async () => {
      const r = await sendAnnouncementAction({
        key,
        ...(on.telegram && targets?.telegram ? { telegram: { text: textFor("telegram") } } : {}),
        ...(on.discord && targets?.discord && channelId ? { discord: { channelId, text: textFor("discord") } } : {}),
      });
      setResult(r);
      if (r.ok && r.results.every((x) => x.status === "sent")) toast({ type: "success", title: `Sent to ${r.results.map((x) => x.label).join(" and ")}.` });
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

function Results({ result, onDone }: { result: Extract<SendAnnouncementResult, { ok: true }>; onDone: () => void }) {
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

/** The last direct posts, each place with its result; a refused place can be sent again from here. */
function Recent({ rows }: { rows: AnnounceRowView[] }) {
  const [pending, start] = useTransition();
  const [note, setNote] = useState<string | null>(null);
  return (
    <div className={styles.recent}>
      <h3 className={styles.recentTitle}>Recent posts</h3>
      <ul className={[styles.results, styles.recentList].join(" ")}>
        {rows.map((r) => (
          <li key={`${r.announcementId}-${r.kind}`} className={styles.result} data-status={r.status}>
            <strong className={styles.brand}><ChannelIcon service={r.kind} size={16} />{r.label}</strong>
            <span className={styles.excerpt}>{r.text}</span>
            <span>{resultWords(r)}</span>
            {r.link && <a className={styles.link} href={r.link} target="_blank" rel="noopener noreferrer">Open the message</a>}
            {r.status === "failed" && (
              <Button variant="ghost" size="sm" loading={pending} onClick={() => start(async () => { const x = await resendAnnouncementAction(r.announcementId, r.kind); setNote(x.ok ? null : x.message); })}>Send again</Button>
            )}
          </li>
        ))}
      </ul>
      {note && <p className={styles.bad} role="alert">{note}</p>}
    </div>
  );
}
