"use client";

/**
 * The places a post goes to, as chips: one per connected place, on or off, and for Discord the channel to post in.
 * Shared by the post composer and the follow-up panel on a draft, so both look and behave the same.
 */
import type { PostTargets } from "@/app/(app)/direct-post-actions";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/registry/components/popover/popover";
import { ChannelIcon } from "./channel-icon";
import styles from "./post-composer.module.css";

export type PlaceKind = "telegram" | "discord";
/** How each kind of place is named to people. */
export const PLACE_NAMES: Record<PlaceKind, string> = { telegram: "Telegram", discord: "Discord" };

/**
 * One chip per place; a Discord chip that is on also picks its channel. Channels the bot cannot post in are listed
 * but cannot be picked.
 *
 * @param props.locked - Places that can no longer change (already sent or failed)
 */
export function PlaceChips({ places, on, onToggle, targets, channelId, onChannel, locked }: {
  places: readonly PlaceKind[];
  on: Record<PlaceKind, boolean>;
  onToggle: (kind: PlaceKind) => void;
  targets: PostTargets;
  channelId: string | null;
  onChannel: (id: string) => void;
  locked?: ReadonlySet<PlaceKind>;
}) {
  const channel = targets.discord?.channels.find((c) => c.id === channelId);
  return (
    <div className={styles.places} role="group" aria-label="Where it goes">
      {places.map((k) => (
        <div key={k} className={styles.chip} data-on={on[k] || undefined}>
          <button type="button" className={styles.chipToggle} aria-pressed={on[k]} disabled={locked?.has(k)} onClick={() => onToggle(k)}>
            <ChannelIcon service={k} size={16} />
            <span>{targets[k]?.label}</span>
            <span className={styles.chipMark} aria-hidden="true">{on[k] ? "✓" : "+"}</span>
          </button>
          {k === "discord" && on.discord && targets.discord && !locked?.has("discord") && (
            <Popover>
              <PopoverTrigger className={styles.chipChannel} aria-label="Discord channel">{channel ? `#${channel.name}` : "Pick a channel"} ▾</PopoverTrigger>
              <PopoverContent className={styles.menu}>
                {targets.discord.channels.map((c) => (
                  <PopoverClose asChild key={c.id}>
                    <button type="button" className={styles.menuItem} disabled={!c.canPost} data-active={c.id === channelId || undefined} onClick={() => onChannel(c.id)}>
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
  );
}
