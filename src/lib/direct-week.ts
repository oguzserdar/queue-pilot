/**
 * @fileoverview Mastodon and Bluesky posts as week posts: each row of a direct post becomes a post on its account's
 * channel ("direct:<account id>"), so the week grid shows them beside Buffer's and their times count as taken.
 */
import type { Post } from "./buffer/queries";
import { isSocialNetwork } from "./social-networks";
import type { DirectPostRow } from "./direct-posts";
import { DIRECT_PREFIX } from "./direct-channel";

const STATUS: Record<Exclude<DirectPostRow["status"], "cancelled">, Post["status"]> = {
  scheduled: "scheduled", pending: "sending", sent: "sent", failed: "error", uncertain: "error",
};

/** The error a direct row shows on the week: none unless it failed or may have been posted. */
function rowError(r: DirectPostRow): { message: string; supportUrl: null } | null {
  if (r.status === "uncertain") return { message: "No answer in time, so it may have been posted. Check the account before sending it again.", supportUrl: null };
  if (r.status === "failed") return { message: r.error ?? "Refused.", supportUrl: null };
  return null;
}

/**
 * Turns direct rows into week posts. The id is "<post id>|<account id>", one per account, because one direct post
 * can go to several accounts and the week shows each on its own row.
 *
 * @param rows - Rows from DirectPostStore.between; cancelled rows are skipped if any slip through
 */
export function directWeekPosts(rows: DirectPostRow[]): Post[] {
  return rows.flatMap((r) => {
    if (r.status === "cancelled" || !isSocialNetwork(r.kind)) return [];
    const at = (r.sendAt ?? r.createdAt).toISOString();
    const error = rowError(r);
    return [{
      id: `${r.postId}|${r.target}`, channelId: `${DIRECT_PREFIX}${r.target}`, status: STATUS[r.status], text: r.text,
      dueAt: at, sentAt: r.status === "sent" ? r.updatedAt.toISOString() : null, externalLink: r.link, error,
      via: "network" as const, createdAt: r.createdAt.toISOString(),
    }];
  });
}
