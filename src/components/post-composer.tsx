"use client";

/**
 * Write one post for Mastodon, Bluesky, Telegram and Discord, without Buffer: the places as chips at the top, one shared
 * text with a tab per place for different text, a live preview of what each place will show, and one button that sends
 * now or at the time picked beside it. The rules (which places, what text, what stops a send) are in
 * lib/composer-places; the pieces are in composer-parts.
 */
import { useEffect, useState, useTransition } from "react";
import { postTargets, sendPostAction, type DirectPostView, type PostTargets, type SendPostResult } from "@/app/(app)/direct-post-actions";
import { composerPlaces, placesOnAtStart, textOf, type ComposerPlace } from "@/lib/composer-places";
import { composerState, type ComposerLoad } from "@/lib/composer-state";
import { resultWords, when } from "@/lib/post-time";
import { Button } from "@/registry/components/button/button";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { ChannelIcon } from "./channel-icon";
import { Previews, TextTabs, WhenPicker } from "./composer-parts";
import { Pager } from "./pager";
import { PlaceChips } from "./place-chips";
import { RecentPosts } from "./recent-posts";
import styles from "./post-composer.module.css";

type Loaded = ComposerLoad;
type SendInput = Parameters<typeof sendPostAction>[0];

const UNREADABLE: PostTargets = { telegram: null, discord: null, problem: "Queue Pilot could not load your channels just now. Close this and try again." };

/** Reads the places; with onlyAccountId, only that account starts on (an empty time in Next week). */
async function loadPlaces(load: () => Promise<PostTargets>, onlyAccountId?: string): Promise<Loaded> {
  const targets = await load().catch(() => UNREADABLE);
  const places = composerPlaces(targets);
  return { targets, places, startOn: placesOnAtStart(places, onlyAccountId), now: Date.now() };
}

/** The request for the chosen places: each with its own text, the Discord channel, and the time when one is picked. */
function sendInput(key: string, chosen: readonly ComposerPlace[], text: (k: string) => string, channelId: string | null, at: Date | null): SendInput {
  const accounts = chosen.flatMap((p) => (p.accountId === null ? [] : [{ id: p.accountId, text: text(p.key) }]));
  return {
    key,
    ...(at ? { sendAt: at.toISOString() } : {}),
    ...(chosen.some((p) => p.kind === "telegram") ? { telegram: { text: text("telegram") } } : {}),
    ...(chosen.some((p) => p.kind === "discord") && channelId ? { discord: { channelId, text: text("discord") } } : {}),
    ...(accounts.length ? { accounts } : {}),
  };
}

/** The time a composer starts with: an empty time's own moment in the reader's zone, or nothing picked yet. */
function presetStart(preset: { at: string } | undefined): { scheduled: boolean; day: Date | undefined; time: string } {
  if (!preset) return { scheduled: false, day: undefined, time: "18:00" };
  const at = new Date(preset.at);
  return { scheduled: true, day: new Date(at.getFullYear(), at.getMonth(), at.getDate()), time: at.toTimeString().slice(0, 5) };
}

export function PostComposer({ recent, pages, loadTargets = postTargets, preset, startOpen, onClose }: {
  recent: DirectPostView[];
  pages?: { older: string | null; newer: string | null };
  loadTargets?: () => Promise<PostTargets>;
  /** Open at once for one account at one time (an empty time in Next week); no button bar, no recent list. */
  preset?: { accountId: string; at: string };
  /** Open at once with every connected place on, without the button bar or recent list (Next week's New post). */
  startOpen?: boolean;
  /** Called when a preset or startOpen composer closes. */
  onClose?: () => void;
}) {
  const bare = preset !== undefined || startOpen === true;
  const [start] = useState(() => presetStart(preset));
  const [open, setOpen] = useState(bare);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [own, setOwn] = useState<Record<string, string>>({});
  const [shared, setShared] = useState("");
  const [tab, setTab] = useState("all");
  const [channelPick, setChannelPick] = useState<string | null>(null);
  const [result, setResult] = useState<SendPostResult | null>(null);
  // One key per composed post: every submit of this form reuses it, so a retry never posts twice.
  const [key, setKey] = useState(() => crypto.randomUUID());
  const [scheduled, setScheduled] = useState(start.scheduled);
  const [day, setDay] = useState(start.day);
  const [time, setTime] = useState(start.time);
  const [loading, startLoad] = useTransition();
  const [sending, startSend] = useTransition();
  const { toast } = useToastStack();
  const onlyAccount = preset?.accountId;

  useEffect(() => {
    if (bare) startLoad(async () => setLoaded(await loadPlaces(loadTargets, onlyAccount)));
  }, [bare, loadTargets, onlyAccount]);

  const openComposer = () => {
    setOpen(true);
    setResult(null);
    startLoad(async () => setLoaded(await loadPlaces(loadTargets)));
  };
  const reset = () => {
    setOpen(false); setShared(""); setOwn({}); setToggled({}); setTab("all"); setScheduled(false); setDay(undefined); setKey(crypto.randomUUID());
    if (bare) onClose?.();
  };
  const writeOwn = (k: string, text: string | null) => setOwn(({ [k]: _dropped, ...rest }) => (text === null ? rest : { ...rest, [k]: text }));

  const { chosen, channelId, channelName, at, whenText, problems, label } = composerState(loaded, { toggled, own, shared, channelPick, scheduled, day, time });
  const text = (k: string) => textOf(k, own, shared);

  const send = () => startSend(async () => {
    const r = await sendPostAction(sendInput(key, chosen, text, channelId, at))
      // The form keeps its key, so pressing the button again never posts twice.
      .catch((): SendPostResult => ({ ok: false, message: "Queue Pilot did not answer, so it may have gone out. Press the button again: it will not post twice." }));
    setResult(r);
    if (!r.ok) return;
    if (r.note) toast({ type: "info", title: r.note });
    else if (r.results.every((x) => x.status === "sent")) toast({ type: "success", title: `Sent to ${r.results.map((x) => x.label).join(" and ")}.` });
    else if (at && r.results.every((x) => x.status === "scheduled")) toast({ type: "success", title: `Scheduled for ${when(at.toISOString())}.` });
  });

  return (
    <>
      {!bare && <ComposerBar onWrite={openComposer} recent={recent} pages={pages} />}
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : reset())}>
        <DialogContent className={styles.dialog} title="New post" description="Each place gets exactly what its preview shows. Text only for now: no images or threads.">
          <ComposerBody loading={loading} loaded={loaded} result={result} onDone={reset}>
            {(l) => (
              <div className={styles.composer}>
                <PlaceChips places={l.places} on={Object.fromEntries(chosen.map((p) => [p.key, true]))} onToggle={(k) => setToggled((o) => ({ ...o, [k]: !chosen.some((p) => p.key === k) }))} discord={l.targets.discord} channelId={channelId} onChannel={setChannelPick} />
                {l.targets.problem && <p className={styles.bad} role="alert">{l.targets.problem}</p>}
                <div className={styles.columns}>
                  <TextTabs chosen={chosen} tab={tab} onTab={setTab} shared={shared} onShared={setShared} own={own} onOwn={writeOwn} />
                  <Previews chosen={chosen} own={own} shared={shared} at={at} discordChannel={channelName} />
                </div>
                <ComposerFooter failure={result && !result.ok ? result.message : null} problem={chosen.length > 0 ? problems[0] ?? null : null}>
                  <WhenPicker label={whenText ?? (scheduled ? "Pick a day" : "Now")} now={l.now} scheduled={scheduled} day={day} time={time} onNow={() => setScheduled(false)} onPick={(d, t) => { setScheduled(true); setDay(d); setTime(t); }} />
                  <Button variant="primary" size="md" loading={sending} disabled={chosen.length === 0 || problems.length > 0} onClick={send}>{label}</Button>
                </ComposerFooter>
              </div>
            )}
          </ComposerBody>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Write a post" with what it does, then the recent posts and their pages (Settings, Channels). */
function ComposerBar({ onWrite, recent, pages }: { onWrite: () => void; recent: DirectPostView[]; pages?: { older: string | null; newer: string | null } }) {
  return (
    <>
      <div className={styles.bar}>
        <Button variant="secondary" size="md" onClick={onWrite}>Write a post</Button>
        <span className={styles.hint}>Post straight to Mastodon, Bluesky, your Telegram channel or a Discord channel, now or later. No Buffer needed.</span>
      </div>
      {recent.length > 0 && <RecentPosts rows={recent} />}
      {pages && <Pager path="/settings" query={{ tab: "channels" }} older={pages.older} newer={pages.newer} label="Recent post pages" names={{ before: "postsBefore", after: "postsAfter" }} />}
    </>
  );
}

/** The send failure or the first problem on the left, the time zone under them, and the When picker and button. */
function ComposerFooter({ failure, problem, children }: { failure: string | null; problem: string | null; children: React.ReactNode }) {
  return (
    <div className={styles.footer}>
      <div className={styles.footLeft}>
        {failure && <p className={styles.bad} role="alert">{failure}</p>}
        {problem && <p className={styles.hint}>{problem}</p>}
        <p className={styles.zone}>Times are in {Intl.DateTimeFormat().resolvedOptions().timeZone}.</p>
      </div>
      <div className={styles.footRight}>{children}</div>
    </div>
  );
}

/** While loading, the results after a send, nothing connected, or the composer itself (given what was loaded). */
function ComposerBody({ loading, loaded, result, onDone, children }: { loading: boolean; loaded: Loaded | null; result: SendPostResult | null; onDone: () => void; children: (loaded: Loaded) => React.ReactNode }) {
  if (loading || !loaded) return <p className={styles.hint}>Checking where Queue Pilot can post…</p>;
  if (result?.ok) return <Results result={result} onDone={onDone} />;
  if (loaded.places.length === 0) {
    return <p className={styles.hint}>Connect Mastodon or Bluesky, a Telegram channel, or add Queue Pilot to a Discord server first, in Settings, Channels.{loaded.targets.problem ? ` ${loaded.targets.problem}` : ""}</p>;
  }
  return children(loaded);
}

function Results({ result, onDone }: { result: Extract<SendPostResult, { ok: true }>; onDone: () => void }) {
  return (
    <div className={styles.form}>
      <ul className={styles.results}>
        {result.results.map((r) => (
          <li key={`${r.kind}-${r.target}`} className={styles.result} data-status={r.status}>
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
