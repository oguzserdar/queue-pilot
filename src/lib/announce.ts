/**
 * Announcements: one message the person writes and sends to their Telegram and/or Discord on its own, with no Buffer
 * post behind it. Each destination is claimed before sending, so a double click, two tabs or a retry never post it
 * twice. A refusal from Telegram or Discord is "failed" and can be sent again by the person; no answer at all is
 * "uncertain", because the message may have landed, and it is never resent.
 */

export type AnnounceKind = "telegram" | "discord";
export type AnnounceStatus = "pending" | "sent" | "failed" | "uncertain";

/** What the person confirmed for one destination: where, and the exact text that goes there. */
export type AnnounceItem = { kind: AnnounceKind; target: string; label: string; text: string };

/** One destination's row, as stored and as shown. */
export type AnnounceRow = AnnounceItem & {
  announcementId: string;
  status: AnnounceStatus;
  attempts: number;
  link: string | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AnnounceStore = {
  /** Claims one destination of a new announcement; false when it is already claimed. */
  claim(userId: string, announcementId: string, item: AnnounceItem, now: Date): Promise<boolean>;
  /** This person's rows for one announcement, so a repeated submit returns what was recorded. */
  rows(userId: string, announcementId: string): Promise<AnnounceRow[]>;
  /** Claims a failed destination again for a resend; the stored row when claimed, else null. */
  reclaimFailed(userId: string, announcementId: string, kind: AnnounceKind, now: Date): Promise<AnnounceRow | null>;
  finish(userId: string, announcementId: string, kind: AnnounceKind, result: { status: AnnounceStatus; link: string | null; error: string | null }, now: Date): Promise<void>;
  recent(userId: string, limit: number): Promise<AnnounceRow[]>;
};

export type AnnounceDeps = {
  store: AnnounceStore;
  /** Posts the exact text; returns a link to the message when the destination has one. */
  post: (item: AnnounceItem) => Promise<{ link: string | null }>;
  /** True when the destination answered with a refusal, so nothing was posted. */
  refused: (e: unknown) => boolean;
  now?: () => Date;
};

export type AnnounceResult = { kind: AnnounceKind; label: string; status: AnnounceStatus; link: string | null; error: string | null };

/** A claim older than this with no result is shown as "may have been sent". */
export const PENDING_MS = 2 * 60_000;
const UNSURE = "No answer in time, so it may have been sent. Check the channel.";

async function deliver(userId: string, announcementId: string, item: AnnounceItem, deps: AnnounceDeps): Promise<AnnounceResult> {
  const now = deps.now ?? (() => new Date());
  let result: { status: AnnounceStatus; link: string | null; error: string | null };
  try {
    result = { status: "sent", link: (await deps.post(item)).link, error: null };
  } catch (e) {
    result = deps.refused(e)
      ? { status: "failed", link: null, error: e instanceof Error ? e.message : String(e) }
      : { status: "uncertain", link: null, error: UNSURE };
  }
  await deps.store.finish(userId, announcementId, item.kind, result, now());
  return { kind: item.kind, label: item.label, ...result };
}

/**
 * The stored id for one composed announcement: the form's key bound to the person, so two people can never share a
 * row and the browser can never name someone else's.
 */
export async function announcementIdFor(userId: string, key: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`qp-announcement|${userId}|${key}`));
  return Buffer.from(digest).toString("base64url");
}

/**
 * Sends one announcement to each chosen destination, one after the other. The key comes from the form and stays the
 * same for every submit of it, so a double click, a second tab or a retry after a dropped connection sends nothing
 * new and returns what was recorded. A new announcement, even with the same text, gets a new key.
 *
 * @param userId - The signed-in person; every row is scoped to them
 * @param key - The form's own id for this announcement
 * @param items - At most one per destination kind, each with its exact text
 * @returns The announcement id and one result per destination: sent now, or as recorded earlier
 * @throws Error when two items name the same destination kind or none is given
 */
export async function sendAnnouncement(userId: string, key: string, items: AnnounceItem[], deps: AnnounceDeps): Promise<{ announcementId: string; results: AnnounceResult[] }> {
  if (!items.length) throw new Error("Choose at least one place to send it.");
  if (new Set(items.map((i) => i.kind)).size !== items.length) throw new Error("Each place can get one message.");
  const now = deps.now ?? (() => new Date());
  const announcementId = await announcementIdFor(userId, key);
  const results: AnnounceResult[] = [];
  for (const item of items) {
    if (await deps.store.claim(userId, announcementId, item, now())) {
      results.push(await deliver(userId, announcementId, item, deps));
      continue;
    }
    const row = (await deps.store.rows(userId, announcementId)).find((r) => r.kind === item.kind);
    if (row) results.push({ kind: row.kind, label: row.label, status: shownStatus(row, now()), link: row.link, error: row.error });
  }
  return { announcementId, results };
}

/**
 * Sends a destination again after Telegram or Discord refused it, with the same text. A sent or uncertain
 * destination is never resent.
 *
 * @returns The new result, or null when there was nothing failed to resend
 */
export async function resendFailed(userId: string, announcementId: string, kind: AnnounceKind, deps: AnnounceDeps): Promise<AnnounceResult | null> {
  const now = deps.now ?? (() => new Date());
  const row = await deps.store.reclaimFailed(userId, announcementId, kind, now());
  if (!row) return null;
  return deliver(userId, announcementId, { kind: row.kind, target: row.target, label: row.label, text: row.text }, deps);
}

/** How a row reads now: a claim that never got a result is "uncertain" once it is older than PENDING_MS. */
export function shownStatus(row: Pick<AnnounceRow, "status" | "updatedAt">, now: Date): AnnounceStatus {
  return row.status === "pending" && now.getTime() - row.updatedAt.getTime() > PENDING_MS ? "uncertain" : row.status;
}

/** An in-memory store for tests and the signed-out example. */
export function memoryAnnounceStore(): AnnounceStore {
  const rows = new Map<string, AnnounceRow & { userId: string }>();
  const key = (a: string, k: AnnounceKind) => `${a}|${k}`;
  return {
    async claim(userId, announcementId, item, now) {
      if (rows.has(key(announcementId, item.kind))) return false;
      rows.set(key(announcementId, item.kind), { ...item, userId, announcementId, status: "pending", attempts: 1, link: null, error: null, createdAt: now, updatedAt: now });
      return true;
    },
    async rows(userId, announcementId) {
      return [...rows.values()].filter((r) => r.userId === userId && r.announcementId === announcementId).map((r) => ({ ...r }));
    },
    async reclaimFailed(userId, announcementId, kind, now) {
      const r = rows.get(key(announcementId, kind));
      if (!r || r.userId !== userId || r.status !== "failed") return null;
      Object.assign(r, { status: "pending", attempts: r.attempts + 1, updatedAt: now });
      return { ...r };
    },
    async finish(userId, announcementId, kind, result, now) {
      const r = rows.get(key(announcementId, kind));
      if (r && r.userId === userId) Object.assign(r, result, { updatedAt: now });
    },
    async recent(userId, limit) {
      return [...rows.values()].filter((r) => r.userId === userId).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
    },
  };
}
