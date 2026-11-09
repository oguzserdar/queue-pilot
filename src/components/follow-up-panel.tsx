"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { followUpFor, postTargets, saveFollowUpAction, type FollowUpPlace, type PostTargets } from "@/app/(app)/direct-post-actions";
import { Button } from "@/registry/components/button/button";
import { Textarea } from "@/registry/components/textarea/textarea";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { ChannelIcon } from "./channel-icon";
import { PLACE_NAMES, PlaceChips, type PlaceKind } from "./place-chips";
import { resultWords } from "./post-composer";
import styles from "./post-composer.module.css";

type Kind = PlaceKind;
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
  const [on, setOn] = useState<Record<Kind, boolean>>({ telegram: false, discord: false });
  const [text, setText] = useState<Record<Kind, string>>({ telegram: draftText, discord: draftText });
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
  const places = (["telegram", "discord"] as const).filter((k) => targets[k]);
  if (!places.length) return null;

  const doneKinds = new Set(saved.filter((p) => p.status !== "scheduled").map((p) => p.kind));
  const save = () =>
    startSave(async () => {
      try {
        // A place the panel could not load (left out) is never changed; null turns a loaded place off.
        const r = await loaders.save(bufferPostId, {
          ...(targets.telegram ? { telegram: on.telegram ? { text: text.telegram } : null } : {}),
          ...(targets.discord ? { discord: on.discord && channelId ? { channelId, text: text.discord } : null } : {}),
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
      <PlaceChips places={places} on={on} onToggle={(k) => setOn((o) => ({ ...o, [k]: !o[k] }))} targets={targets} channelId={channelId} onChannel={setChannelId} locked={doneKinds} />
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
