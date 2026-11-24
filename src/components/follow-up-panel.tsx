"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { followUpFor, postTargets, saveFollowUpAction, type FollowUpPlace, type PostTargets } from "@/app/(app)/direct-post-actions";
import { Button } from "@/registry/components/button/button";
import { Textarea } from "@/registry/components/textarea/textarea";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { ChannelIcon } from "./channel-icon";
import { PLACE_NAMES, PlaceChips } from "./place-chips";
import { resultWords } from "@/lib/post-time";
import { composerPlaces } from "@/lib/composer-places";
import styles from "./post-composer.module.css";

const NAME = PLACE_NAMES;
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
  // Keyed by place: "telegram" and "discord" (a follow-up goes only to the bots).
  const [on, setOn] = useState<Record<string, boolean>>({});
  const [text, setText] = useState<Record<string, string>>({});
  const [channelId, setChannelId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [loading, startLoad] = useTransition();
  // The draft's text only seeds a new place's box; a later change to it must not reload the panel and wipe edits.
  const seed = useRef(draftText);
  const [saving, startSave] = useTransition();
  const { toast } = useToastStack();

  useEffect(() => {
    startLoad(async () => {
      try {
        const [t, f] = await Promise.all([loaders.targets(), loaders.followUp(bufferPostId)]);
        setTargets(t);
        setSaved(f.places);
        const tg = f.places.find((p) => p.kind === "telegram");
        const dc = f.places.find((p) => p.kind === "discord");
        setOn({ telegram: !!tg, discord: !!dc });
        setText({ telegram: tg?.text ?? seed.current, discord: dc?.text ?? seed.current });
        setChannelId(dc?.target ?? t.discord?.defaultId ?? null);
      } catch {
        setFailed(true);
      }
    });
  }, [bufferPostId, loaders]);

  if (failed) return <p className={styles.hint} role="status">Queue Pilot could not load the Telegram and Discord follow-up just now. Open the post again to retry.</p>;
  if (loading || !targets) return null;
  const places = composerPlaces({ telegram: targets.telegram, discord: targets.discord });
  if (!places.length) return null;

  const doneKinds = new Set<string>(saved.filter((p) => p.status !== "scheduled").map((p) => p.kind));
  // The load fills both places' text (the draft's text to start), so drawing never reads the seed ref.
  const textFor = (key: string) => text[key] ?? "";
  const saveLabel = !places.some((p) => on[p.key]) && saved.some((p) => p.status === "scheduled") ? "Turn off" : "Save";
  const save = () =>
    startSave(async () => {
      try {
        // A place the panel could not load (left out) is never changed; null turns a loaded place off.
        const r = await loaders.save(bufferPostId, {
          ...(targets.telegram ? { telegram: on.telegram ? { text: textFor("telegram") } : null } : {}),
          ...(targets.discord ? { discord: on.discord && channelId ? { channelId, text: textFor("discord") } : null } : {}),
        });
        if (!r.ok) { setNote(r.message); return; }
        setNote(r.note ?? null);
        setSaved(r.places);
        const waiting = r.places.filter((p) => p.status === "scheduled").map((p) => NAME[p.kind]);
        toast({ type: "success", title: waiting.length ? `Set: ${waiting.join(" and ")} when Buffer publishes this.` : "Turned off." });
      } catch {
        setNote("Queue Pilot did not answer, so the follow-up may not be saved. Save again.");
      }
    });

  return (
    <section className={styles.follow} aria-label="Also post to Telegram and Discord">
      <h3 className={styles.followTitle}>Also post to Telegram and Discord</h3>
      <p className={styles.hint} suppressHydrationWarning>
        When Buffer publishes this post, Queue Pilot sends it to the places you turn on, with the text below.
      </p>
      {targets.problem && <p className={styles.bad} role="status">{targets.problem} Discord is left as it is.</p>}
      <PlaceChips places={places} on={on} onToggle={(k) => setOn((o) => ({ ...o, [k]: !o[k] }))} discord={targets.discord} channelId={channelId} onChannel={setChannelId} locked={doneKinds} />
      {places.filter((p) => on[p.key]).map(({ key: k, kind, limit }) => {
        const result = saved.find((p) => p.kind === kind);
        const value = textFor(k);
        return (
          <div key={k} className={styles.followPlace}>
            {result && result.status !== "scheduled" ? (
              <p className={styles.result} data-status={result.status}>
                <strong className={styles.brand}><ChannelIcon service={kind} size={14} />{result.label}</strong>
                <span>{resultWords(result)}</span>
                {result.link && <a className={styles.link} href={result.link} target="_blank" rel="noopener noreferrer">Open the message</a>}
              </p>
            ) : (
              <>
                <Textarea label={`Text for ${NAME[kind]}`} rows={3} value={value} onChange={(e) => setText((t) => ({ ...t, [k]: e.target.value }))} />
                <span className={value.trim().length > limit ? styles.bad : styles.count}>{value.trim().length.toLocaleString("en-GB")} / {limit.toLocaleString("en-GB")}</span>
              </>
            )}
          </div>
        );
      })}
      {note && <p className={styles.bad} role="alert">{note}</p>}
      {places.some((p) => !doneKinds.has(p.key)) && <div className={styles.followFoot}>
        <Button variant="secondary" size="sm" loading={saving} onClick={save}>{saveLabel}</Button>
      </div>}
    </section>
  );
}
