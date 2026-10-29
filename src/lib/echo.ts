/**
 * The echo: once Buffer reports a post as sent, copy it to the user's Telegram channel and Discord channel, exactly
 * once per (post, destination). Buffer has no webhooks (developers.buffer.com, efficient-api-usage), so this runs from
 * the snapshot after a refresh. Each copy is claimed before sending, so two runs at the same moment (a sync and an AI
 * call) cannot both send it; a failed copy is retried on a later run until MAX_ATTEMPTS, and a copy that already landed
 * is never sent again.
 */
import type { Post } from "./buffer/queries";

export type Destination = { id: string; kind: "telegram" | "discord"; label: string };
export type EchoRecord = { postId: string; destinationId: string; status: "sent" | "failed"; attempts: number; messageId?: string; error?: string };
export type EchoSend = { post: Post; destination: Destination };

export const MAX_ATTEMPTS = 3;
/**
 * Only posts sent this recently are copied. Two days, so the once-a-day scheduled run (api/cron/echo) never misses a
 * post between runs; connecting a channel still never floods it, because posts sent before it was connected are skipped.
 */
export const ECHO_WINDOW_MS = 48 * 60 * 60_000;

/** Which copies still need sending: sent posts in the window, per destination, not yet landed and not given up on. */
export function planEchoes(posts: Post[], destinations: Destination[], records: EchoRecord[], now: Date, connectedAt: Record<string, Date>): EchoSend[] {
  const byKey = new Map(records.map((r) => [`${r.postId}|${r.destinationId}`, r]));
  const out: EchoSend[] = [];
  for (const post of posts) {
    if (post.status !== "sent" || !post.sentAt) continue;
    // A reminder post was only published if the person marked it so; Buffer did not post it.
    if (post.schedulingType === "notification" && post.notificationStatus !== "markedAsPublished") continue;
    const sent = Date.parse(post.sentAt);
    if (now.getTime() - sent > ECHO_WINDOW_MS) continue;
    for (const destination of destinations) {
      // Never copy a post sent before this destination was connected.
      const since = connectedAt[destination.id];
      if (since && sent < since.getTime()) continue;
      const r = byKey.get(`${post.id}|${destination.id}`);
      if (r?.status === "sent" || (r && r.attempts >= MAX_ATTEMPTS)) continue;
      out.push({ post, destination });
    }
  }
  return out.sort((a, b) => (a.post.sentAt ?? "").localeCompare(b.post.sentAt ?? ""));
}

export type EchoDeps = {
  /** Reserves this copy for this run; false when another run holds it or it already landed, so it is skipped. */
  claim: (postId: string, destinationId: string) => Promise<boolean>;
  send: (s: EchoSend) => Promise<{ messageId: string }>;
  record: (r: EchoRecord) => Promise<void>;
  previous: (postId: string, destinationId: string) => EchoRecord | undefined;
};

/** Sends the planned copies one by one and records each result. Returns what happened, for the delivery screen. */
export async function runEchoes(plan: EchoSend[], deps: EchoDeps): Promise<EchoRecord[]> {
  const done: EchoRecord[] = [];
  for (const s of plan) {
    if (!(await deps.claim(s.post.id, s.destination.id))) continue;
    const attempts = (deps.previous(s.post.id, s.destination.id)?.attempts ?? 0) + 1;
    let rec: EchoRecord;
    try {
      const { messageId } = await deps.send(s);
      rec = { postId: s.post.id, destinationId: s.destination.id, status: "sent", attempts, messageId };
    } catch (e) {
      rec = { postId: s.post.id, destinationId: s.destination.id, status: "failed", attempts, error: e instanceof Error ? e.message : String(e) };
    }
    try {
      await deps.record(rec);
    } catch (e) {
      // The copy itself is done; one lost record must not stop the other copies. Its claim still blocks a resend
      // until it expires.
      console.warn(JSON.stringify({ event: "qp-echo-record-failed", postId: rec.postId, message: e instanceof Error ? e.message : String(e) }));
    }
    done.push(rec);
  }
  return done;
}

/** The first image on a post, for the copy; videos and documents are linked through the post's own link instead. */
export function imageOf(post: Post): string | null {
  return post.assets?.find((a) => a.type === "image" && /^https:\/\//.test(a.source))?.source ?? null;
}
