"use client";

/**
 * Parts of the week page (src/components/week-view.tsx): the posts that would fail, Approve all with its confirm step,
 * the empty states without channels, the grid and phone list, and the composer for an empty time.
 */
import type { ReactNode } from "react";
import { ArrowUpRight } from "lucide-react";
import { BUFFER_CHANNELS_URL } from "@/lib/connect-links";
import { Button } from "@/registry/components/button/button";
import { Badge } from "@/registry/components/badge/badge";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { Popover, PopoverContent, PopoverTrigger } from "@/registry/components/popover/popover";
import { directAccountId } from "@/lib/direct-channel";
import { parseSlotId } from "@/lib/open-slots";
import { zoneLabel, type WeekModel, type WeekPost } from "@/lib/week-model";
import { ChannelIcon } from "./channel-icon";
import { SlotComposer, type ComposerSlot } from "./slot-composer";
import { PostComposer } from "./post-composer";
import styles from "./week-view.module.css";

/** Day names, Monday first. */
export const FULL_DAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

/** The Approve-all button's words. */
export function approveAllLabel(pending: boolean, ready: number, waiting: number, approvedAny: boolean): string {
  if (pending) return "Approving…";
  if (ready > 0) return `Approve ${ready} draft${ready === 1 ? "" : "s"}`;
  return waiting > 0 || !approvedAny ? "Nothing ready to approve" : "All approved";
}

/** Posts that would fail sit behind one button, so the week stays where it is; each card is marked too. */
export function WouldFail({ blocked, channels, onOpen }: { blocked: WeekPost[]; channels: WeekModel["channels"]; onOpen: (id: string) => void }) {
  if (!blocked.length) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="md" className={styles.issues}>
          <span className={styles.issueDot} aria-hidden="true" />
          {`${blocked.length} post${blocked.length === 1 ? "" : "s"} would fail`}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className={styles.issueList}>
        {blocked.map((b) => (
          <div key={b.id} className={styles.issue}>
            <strong>{`${FULL_DAY[b.day]}'s ${channels.find((c) => c.id === b.channel)?.name ?? ""} post`}</strong>
            <span>{b.checks?.find((c) => c.tone === "danger")?.label ?? "A check failed for this post."}</span>
            <Button variant="secondary" size="sm" onClick={() => onOpen(b.id)}>Open post</Button>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Approve every ready draft, with one confirm step that says how many will be scheduled. */
export function ApproveAll({ ready, waiting, approvedAny, pending, writingNow, confirming, setConfirming, onApprove }: { ready: number; waiting: number; approvedAny: boolean; pending: boolean; writingNow: boolean; confirming: boolean; setConfirming: (on: boolean) => void; onApprove: () => void }) {
  if (!confirming) {
    return (
      <Button variant="primary" size="md" disabled={ready === 0 || pending || writingNow} onClick={() => setConfirming(true)}>
        {approveAllLabel(pending, ready, waiting, approvedAny)}
      </Button>
    );
  }
  return (
    <>
      <Button variant="ghost" size="md" autoFocus onClick={() => setConfirming(false)}>Cancel</Button>
      <Button variant="primary" size="md" onClick={() => { setConfirming(false); onApprove(); }}>
        {`Schedule ${ready} post${ready === 1 ? "" : "s"} in Buffer`}
      </Button>
    </>
  );
}

/** A week with no channels: connect an account (without Buffer) or add a channel in Buffer. */
export function NoChannels({ noBuffer }: { noBuffer: boolean }) {
  if (noBuffer) {
    return (
      <EmptyState
        title="Nothing to plan yet"
        description="Connect Mastodon or Bluesky, then set its posting times. They show here, and you write a post for each empty one."
        action={<a className={styles.connect} href="/settings?tab=channels">Connect an account</a>}
      />
    );
  }
  return (
    <EmptyState
      title="No channels in Buffer yet"
      description="Your posting times appear here once Buffer has a channel. Queue Pilot then fills the empty ones with drafts for you to approve."
      action={<a className={styles.connect} href={BUFFER_CHANNELS_URL} target="_blank" rel="noreferrer">Add a channel in Buffer <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" /></a>}
    />
  );
}

/** The week as a grid of channels by days, and on a phone as a list by day; `cell` draws one channel's day. */
export function WeekGrid({ week, name, dayHasContent, cell }: { week: WeekModel; name: string; dayHasContent: (d: number) => boolean; cell: (channelId: string, day: number) => ReactNode[] }) {
  const { days: DAYS, channels } = week;
  return (
    <div className={styles.layout}>
      <div className={styles.gridWrap}>
        <div className={styles.grid} role="table" aria-label={`Posting slots for ${name.toLowerCase()}`} style={{ gridTemplateColumns: `max-content ${DAYS.map((_, d) => (dayHasContent(d) ? "minmax(132px, 1fr)" : "56px")).join(" ")}` }}>
          <div className={styles.corner}>{week.timeZone && week.startsAt && <span className={styles.zone}>Times in {zoneLabel(week.timeZone, new Date(week.startsAt))}</span>}</div>
          {DAYS.map((d, i) => {
            const has = dayHasContent(i);
            return <div key={d} className={styles.day} data-empty={!has} role="columnheader">{has ? d : d.split(" ")[0]}</div>;
          })}
          {channels.map((ch) => (
            <div key={ch.id} className={styles.row} role="row">
              <div className={styles.channel} role="rowheader">
                <span className={styles.chip}><ChannelIcon service={ch.service} />{ch.name}</span>
                {ch.timezone && week.timeZone && week.startsAt && ch.timezone !== week.timeZone && (
                  <span className={styles.zone}>{zoneLabel(ch.timezone, new Date(week.startsAt))} times</span>
                )}
                {ch.isDisconnected && <>{" "}<Badge tone="danger" size="sm">Disconnected</Badge></>}
              </div>
              {DAYS.map((_, day) => (
                <div key={day} className={styles.cell} role="cell">
                  {cell(ch.id, day)}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>

      {/* On a phone the week reads as a list by day, each post labelled with its channel (the grid is hidden). */}
      <div className={styles.list} aria-label={`Posting slots for ${name.toLowerCase()}, by day`}>
        {DAYS.map((d, day) => dayHasContent(day) && (
          <section key={d} className={styles.listDay} aria-label={d}>
            <h2 className={styles.listHead}>{d}</h2>
            {channels.map((ch) => {
              const items = cell(ch.id, day);
              return items.length > 0 && (
                <div key={ch.id} className={styles.listChannel}>
                  <span className={styles.chip}><ChannelIcon service={ch.service} />{ch.name}</span>
                  {ch.isDisconnected && <>{" "}<Badge tone="danger" size="sm">Disconnected</Badge></>}
                  {items}
                </div>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}

/**
 * An empty time of a Mastodon or Bluesky account opens the direct composer for that account and moment; a Buffer
 * channel's opens the Buffer draft composer.
 */
export function ComposerFor({ composing, live, onDirectClose, onClose }: { composing: ComposerSlot | null; live: boolean; onDirectClose: () => void; onClose: (saved?: string) => void }) {
  const id = composing?.id;
  const slot = id ? parseSlotId(id) : null;
  const accountId = slot ? directAccountId(slot.channelId) : null;
  if (id && slot && accountId && live) return <PostComposer key={id} recent={[]} preset={{ accountId, at: slot.at }} onClose={onDirectClose} />;
  return <SlotComposer slot={accountId ? null : composing} live={live} onClose={onClose} />;
}
