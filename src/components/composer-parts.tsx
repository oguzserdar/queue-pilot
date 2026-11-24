"use client";

/**
 * The pieces of the post composer: the text tabs with their counts, the previews, and the When picker. Each takes plain
 * values and callbacks; the composer holds the state.
 */
import { countFor } from "@/lib/char-limits";
import { textOf, type ComposerPlace } from "@/lib/composer-places";
import { Button } from "@/registry/components/button/button";
import { DatePicker } from "@/registry/components/date-picker/date-picker";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/registry/components/popover/popover";
import { Textarea } from "@/registry/components/textarea/textarea";
import { TimePicker } from "@/registry/components/time-picker/time-picker";
import { ChannelIcon } from "./channel-icon";
import { PLACE_NAMES } from "./place-chips";
import { atLocal, daysFrom, shortHandle, when } from "@/lib/post-time";
import styles from "./post-composer.module.css";

const ALL = "all";
const DAY_MS = 86_400_000;

/** A place's name on its tab: the network for a bot, the handle's name part for an account. */
const tabName = (p: ComposerPlace) => (p.accountId === null ? PLACE_NAMES[p.kind] : shortHandle(p.label));

/** Puts the cursor after the text, so writing different text continues where the shared text ended. */
const cursorToEnd = (e: React.FocusEvent<HTMLTextAreaElement>) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length);

/**
 * The shared text, a tab per chosen place for different text, and each place's count against its limit.
 *
 * @param props.own - Text written for one place, by place key; a place without an entry uses the shared text
 */
export function TextTabs({ chosen, tab, onTab, shared, onShared, own, onOwn }: {
  chosen: readonly ComposerPlace[];
  tab: string;
  onTab: (key: string) => void;
  shared: string;
  onShared: (text: string) => void;
  own: Readonly<Record<string, string>>;
  onOwn: (key: string, text: string | null) => void;
}) {
  const current = chosen.find((p) => p.key === tab);
  return (
    <div className={styles.write}>
      <div className={styles.tabs} role="tablist" aria-label="Text">
        <button type="button" role="tab" aria-selected={!current} className={styles.tab} onClick={() => onTab(ALL)}>All places</button>
        {chosen.map((p) => (
          <button key={p.key} type="button" role="tab" aria-selected={current?.key === p.key} className={styles.tab} onClick={() => onTab(p.key)}>
            <ChannelIcon service={p.kind} size={14} /><span title={p.label}>{tabName(p)}</span>{p.key in own && <span className={styles.dot} aria-label="own text" />}
          </button>
        ))}
      </div>
      {current ? <PlaceText place={current} own={own} shared={shared} onOwn={onOwn} /> : (
        <Textarea label="Post" rows={9} value={shared} onChange={(e) => onShared(e.target.value)} placeholder="Patch 1.4 is out. Exports now resume after a dropped connection." />
      )}
      <div className={styles.counts}>
        {chosen.map((p) => {
          const n = countFor(p.kind, textOf(p.key, own, shared));
          return <span key={p.key} className={n > p.limit ? styles.bad : styles.count}><ChannelIcon service={p.kind} size={12} />{n.toLocaleString("en-GB")} / {p.limit.toLocaleString("en-GB")}</span>;
        })}
      </div>
    </div>
  );
}

/** One place's tab: the shared text with a button to write different text, or its own text and a way back. */
function PlaceText({ place, own, shared, onOwn }: { place: ComposerPlace; own: Readonly<Record<string, string>>; shared: string; onOwn: (key: string, text: string | null) => void }) {
  const name = tabName(place);
  const mine = own[place.key];
  if (mine === undefined) {
    return (
      <div className={styles.shared}>
        <p className={styles.hint}>{name} uses the text from All places.</p>
        <Button variant="secondary" size="sm" onClick={() => onOwn(place.key, shared)}>Write different text for {name}</Button>
      </div>
    );
  }
  return (
    <>
      <Textarea label={`Text for ${name}`} rows={9} autoFocus onFocus={cursorToEnd} value={mine} onChange={(e) => onOwn(place.key, e.target.value)} />
      <button type="button" className={styles.link} onClick={() => onOwn(place.key, null)}>Use the text from All places again</button>
    </>
  );
}

/**
 * What each chosen place will show: a post card for an account, a Telegram bubble, a Discord message.
 *
 * @param props.at - When it goes out, or null for now
 */
export function Previews({ chosen, own, shared, at, discordChannel }: { chosen: readonly ComposerPlace[]; own: Readonly<Record<string, string>>; shared: string; at: Date | null; discordChannel: string | null }) {
  if (chosen.length === 0) return <div className={styles.previews} aria-label="Preview"><p className={styles.hint}>Turn on a place to see its preview.</p></div>;
  return (
    <div className={styles.previews} aria-label="Preview">
      {chosen.map((p) => <Preview key={p.key} place={p} text={textOf(p.key, own, shared)} at={at} discordChannel={discordChannel} />)}
    </div>
  );
}

function Preview({ place, text, at, discordChannel }: { place: ComposerPlace; text: string; at: Date | null; discordChannel: string | null }) {
  const body = text ? <p className={styles.msg}>{text}</p> : <p className={styles.empty}>Your post shows here.</p>;
  const shown = at ? when(at.toISOString()) : "now";
  if (place.kind === "telegram") {
    return (
      <figure className={styles.tg}>
        <figcaption className={styles.tgHead}><span className={styles.tgAvatar}>{(place.label[0] ?? "T").toUpperCase()}</span><span>{place.label}</span></figcaption>
        <div className={styles.tgBubble}>{body}<span className={styles.tgTime} suppressHydrationWarning>{shown}</span></div>
      </figure>
    );
  }
  if (place.kind === "discord") {
    return (
      <figure className={styles.dc}>
        <figcaption className={styles.dcHead}># {discordChannel ?? "channel"}</figcaption>
        <div className={styles.dcRow}>
          <span className={styles.dcAvatar} aria-hidden="true">QP</span>
          <div className={styles.dcBody}>
            <p className={styles.dcName}>Queue Pilot <span className={styles.dcApp}>APP</span> <span className={styles.dcTime} suppressHydrationWarning>{shown}</span></p>
            {body}
          </div>
        </div>
      </figure>
    );
  }
  return (
    <figure className={styles.social}>
      <figcaption className={styles.socialHead}><ChannelIcon service={place.kind} size={14} /><span>{place.label}</span><span className={styles.socialTime} suppressHydrationWarning>{shown}</span></figcaption>
      {body}
    </figure>
  );
}

/**
 * Now, a quick pick, or a day and time, for when the post goes out.
 *
 * @param props.now - The moment the composer opened (ms), so the quick picks and the earliest day do not read the clock while drawing
 */
export function WhenPicker({ label, now, scheduled, day, time, onNow, onPick }: {
  label: string;
  now: number;
  scheduled: boolean;
  day: Date | undefined;
  time: string;
  onNow: () => void;
  onPick: (day: Date | undefined, time: string) => void;
}) {
  const today = new Date(now);
  const quick = [
    { label: "This evening, 18:00", day: daysFrom(today, 0), time: "18:00" },
    { label: "Tomorrow, 09:00", day: daysFrom(today, 1), time: "09:00" },
  ].filter((q) => (atLocal(q.day, q.time)?.getTime() ?? 0) > now + 60_000);
  return (
    <Popover>
      <PopoverTrigger className={styles.whenButton} aria-label="When to send">
        <span className={styles.whenLabel}>When</span>
        <span suppressHydrationWarning>{label}</span> ▾
      </PopoverTrigger>
      <PopoverContent className={styles.whenPanel} align="end">
        <PopoverClose asChild>
          <button type="button" className={styles.menuItem} data-active={!scheduled || undefined} onClick={onNow}><span>Now</span><span className={styles.menuNote}>Send as soon as you press the button</span></button>
        </PopoverClose>
        {quick.map((q) => (
          <PopoverClose asChild key={q.label}>
            <button type="button" className={styles.menuItem} onClick={() => onPick(q.day, q.time)}><span>{q.label}</span></button>
          </PopoverClose>
        ))}
        <div className={styles.pick}>
          <span className={styles.whenLabel}>Pick a day and time</span>
          <div className={styles.whenRow}>
            <DatePicker label="Day" side="top" value={day} onChange={(d) => onPick(d, time)} minDate={daysFrom(today, 0)} maxDate={new Date(now + 60 * DAY_MS)} showToday />
            <TimePicker label="Time" value={time} onChange={(t) => onPick(day, t)} minuteStep={5} format="24h" />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
