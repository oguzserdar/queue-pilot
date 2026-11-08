"use client";

import { useEffect, useState, useTransition } from "react";
import { followUpFor, postTargets, saveFollowUpAction, type FollowUpPlace, type PostTargets } from "@/app/(app)/direct-post-actions";
import { Button } from "@/registry/components/button/button";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/registry/components/popover/popover";
import { Textarea } from "@/registry/components/textarea/textarea";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { ChannelIcon } from "./channel-icon";
import { resultWords, when } from "./post-composer";
import styles from "./post-composer.module.css";

type Kind = "telegram" | "discord";
const NAME: Record<Kind, string> = { telegram: "Telegram", discord: "Discord" };
/** The real loaders, defined once so the panel's effect does not rerun on every render. */
const LIVE = { targets: postTargets, followUp: followUpFor, save: saveFollowUpAction };

/**
 * On a draft: also post it to the person's Telegram channel and a Discord channel when Buffer publishes it, each with
 * its own text (the draft's text to start). Shows each place's result once the post has gone out.
 */
export function FollowUpPanel({ bufferPostId, draftText, loaders = LIVE }: {
  bufferPostId: string;
  draftText: string;
  /** Where places, the saved follow-up and saving come from; the development page passes samples. */
  loaders?: { targets: typeof postTargets; followUp: typeof followUpFor; save: typeof saveFollowUpAction };
}) {
  const [targets, setTargets] = useState<PostTargets | null>(null);
  const [saved, setSaved] = useState<FollowUpPlace[]>([]);
  const [dueAt, setDueAt] = useState<string | null>(null);
  const [on, setOn] = useState<Record<Kind, boolean>>({ telegram: false, discord: false });
  const [text, setText] = useState<Record<Kind, string>>({ telegram: draftText, discord: draftText });
  const [channelId, setChannelId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();
  const { toast } = useToastStack();

  useEffect(() => {
    startLoad(async () => {
      const [t, f] = await Promise.all([loaders.targets(), loaders.followUp(bufferPostId)]);
      setTargets(t);
      setSaved(f.places);
      setDueAt(f.dueAt);
      const tg = f.places.find((p) => p.kind === "telegram");
      const dc = f.places.find((p) => p.kind === "discord");
      setOn({ telegram: !!tg, discord: !!dc });
      setText({ telegram: tg?.text ?? draftText, discord: dc?.text ?? draftText });
      setChannelId(dc?.target ?? t.discord?.defaultId ?? null);
    });
  }, [bufferPostId, draftText, loaders]);

  if (loading || !targets) return null;
  const places = (["telegram", "discord"] as const).filter((k) => targets[k]);
  if (!places.length) return null;

  const channel = targets.discord?.channels.find((c) => c.id === channelId);
  const doneKinds = new Set(saved.filter((p) => p.status !== "scheduled").map((p) => p.kind));
  const save = () =>
    startSave(async () => {
      const r = await loaders.save(bufferPostId, {
        telegram: on.telegram && targets.telegram ? { text: text.telegram } : null,
        discord: on.discord && targets.discord && channelId ? { channelId, text: text.discord } : null,
      });
      if (!r.ok) { setNote(r.message); return; }
      setNote(null);
      const f = await loaders.followUp(bufferPostId);
      setSaved(f.places);
      const n = f.places.filter((p) => p.status === "scheduled").length;
      toast({ type: "success", title: n ? `Set: ${n === 2 ? "Telegram and Discord" : NAME[f.places.find((p) => p.status === "scheduled")!.kind]} when Buffer publishes this.` : "Turned off." });
    });

  return (
    <section className={styles.follow} aria-label="Also post to Telegram and Discord">
      <h3 className={styles.followTitle}>Also post to Telegram and Discord</h3>
      <p className={styles.hint} suppressHydrationWarning>
        When Buffer publishes this{dueAt ? ` (${when(dueAt)})` : ""}, Queue Pilot sends it to the places you turn on, with the text below.
      </p>
      <div className={styles.places}>
        {places.map((k) => (
          <div key={k} className={styles.chip} data-on={on[k] || undefined}>
            <button type="button" className={styles.chipToggle} aria-pressed={on[k]} disabled={doneKinds.has(k)} onClick={() => setOn((o) => ({ ...o, [k]: !o[k] }))}>
              <ChannelIcon service={k} size={16} />
              <span>{targets[k]!.label}</span>
              <span className={styles.chipMark} aria-hidden="true">{on[k] ? "✓" : "+"}</span>
            </button>
            {k === "discord" && on.discord && targets.discord && !doneKinds.has("discord") && (
              <Popover>
                <PopoverTrigger className={styles.chipChannel} aria-label="Discord channel">{channel ? `#${channel.name}` : "Pick a channel"} ▾</PopoverTrigger>
                <PopoverContent className={styles.menu}>
                  {targets.discord.channels.map((c) => (
                    <PopoverClose asChild key={c.id}>
                      <button type="button" className={styles.menuItem} disabled={!c.canPost} data-active={c.id === channelId || undefined} onClick={() => setChannelId(c.id)}>
                        <span>#{c.name}</span>
                        {!c.canPost && <span className={styles.menuNote}>Queue Pilot cannot post here</span>}
                      </button>
                    </PopoverClose>
                  ))}
                </PopoverContent>
              </Popover>
            )}
          </div>
        ))}
      </div>
      {places.filter((k) => on[k]).map((k) => {
        const result = saved.find((p) => p.kind === k);
        const limit = targets[k]!.limit;
        return (
          <div key={k} className={styles.followPlace}>
            {result && result.status !== "scheduled" ? (
              <p className={styles.result} data-status={result.status}>
                <strong className={styles.brand}><ChannelIcon service={k} size={14} />{result.label}</strong>
                <span>{resultWords(result)}</span>
                {result.link && <a className={styles.link} href={result.link} target="_blank" rel="noopener noreferrer">Open the message</a>}
              </p>
            ) : (
              <>
                <Textarea label={`Text for ${NAME[k]}`} rows={3} value={text[k]} onChange={(e) => setText((t) => ({ ...t, [k]: e.target.value }))} />
                <span className={text[k].trim().length > limit ? styles.bad : styles.count}>{text[k].trim().length.toLocaleString("en-GB")} / {limit.toLocaleString("en-GB")}</span>
              </>
            )}
          </div>
        );
      })}
      {note && <p className={styles.bad} role="alert">{note}</p>}
      {places.some((k) => !doneKinds.has(k)) && <div className={styles.followFoot}>
        <Button variant="secondary" size="sm" loading={saving} onClick={save}>{places.some((k) => on[k]) ? "Save" : saved.some((p) => p.status === "scheduled") ? "Turn off" : "Save"}</Button>
      </div>}
    </section>
  );
}
