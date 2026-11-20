"use client";

/**
 * The places a post goes to, as chips: one per place, on or off, and for Discord the channel to post in. Shared by the
 * post composer and the follow-up panel on a draft, so both look and behave the same.
 */
import type { PostTargets } from "@/app/(app)/direct-post-actions";
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from "@/registry/components/popover/popover";
import type { ComposerPlace } from "@/lib/composer-places";
import { PLACE_NAME, type PostKind } from "@/lib/direct-posts";
import { ChannelIcon } from "./channel-icon";
import styles from "./post-composer.module.css";

/** How each kind of place is named to people. */
export const PLACE_NAMES: Record<PostKind, string> = PLACE_NAME;

/**
 * One chip per place; a Discord chip that is on also picks its channel. Channels the bot cannot post in are listed
 * but cannot be picked.
 *
 * @param props.locked - Keys of places that can no longer change (already sent or failed)
 */
export function PlaceChips({ places, on, onToggle, discord, channelId, onChannel, locked }: {
  places: readonly ComposerPlace[];
  on: Readonly<Record<string, boolean>>;
  onToggle: (key: string) => void;
  discord: PostTargets["discord"];
  channelId: string | null;
  onChannel: (id: string) => void;
  locked?: ReadonlySet<string>;
}) {
  return (
    <div className={styles.places} role="group" aria-label="Where it goes">
      {places.map((p) => (
        <div key={p.key} className={styles.chip} data-on={on[p.key] || undefined}>
          <button type="button" className={styles.chipToggle} aria-pressed={on[p.key] === true} disabled={locked?.has(p.key)} onClick={() => onToggle(p.key)}>
            <ChannelIcon service={p.kind} size={16} />
            <span>{p.label}</span>
            <span className={styles.chipMark} aria-hidden="true">{on[p.key] ? "✓" : "+"}</span>
          </button>
          {p.kind === "discord" && on[p.key] && discord && !locked?.has(p.key) && (
            <ChannelPicker channels={discord.channels} channelId={channelId} onChannel={onChannel} />
          )}
        </div>
      ))}
    </div>
  );
}

/** The Discord channel menu on the Discord chip. */
function ChannelPicker({ channels, channelId, onChannel }: { channels: NonNullable<PostTargets["discord"]>["channels"]; channelId: string | null; onChannel: (id: string) => void }) {
  const channel = channels.find((c) => c.id === channelId);
  return (
    <Popover>
      <PopoverTrigger className={styles.chipChannel} aria-label="Discord channel">{channel ? `#${channel.name}` : "Pick a channel"} ▾</PopoverTrigger>
      <PopoverContent className={styles.menu}>
        {channels.map((c) => (
          <PopoverClose asChild key={c.id}>
            <button type="button" className={styles.menuItem} disabled={!c.canPost} data-active={c.id === channelId || undefined} onClick={() => onChannel(c.id)}>
              <span>#{c.name}</span>
              {!c.canPost && <span className={styles.menuNote}>Queue Pilot cannot post here</span>}
            </button>
          </PopoverClose>
        ))}
      </PopoverContent>
    </Popover>
  );
}
