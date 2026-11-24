/**
 * @fileoverview What the connector tool groups share: the Buffer copy a tool reads, answer builders, and small helpers
 * for the words of an answer.
 * @module app/api/mcp/tool-kit
 */
import { type TranscriptResult } from "@/lib/transcripts";
import { McpServer } from "@modelcontextprotocol/server";
import { getAuth } from "@/lib/auth";
import { bufferAccessToken } from "@/lib/buffer-token";
import { refreshSnapshot, type Snapshot } from "@/lib/buffer/snapshot";
import { postgresSnapshotStore } from "@/lib/buffer/snapshot-store";
import { weekFromBuffer } from "@/lib/week-from-buffer";
import { knownRange } from "@/lib/open-slots";
import type { ConnectedApp } from "@/lib/app-identity";
import { type Actor } from "@/lib/security-events";
import { postingState, type TeamMember } from "@/lib/buffer/workspace";
import { listIdeaGroups } from "@/lib/buffer/ideas";
import { type Post } from "@/lib/buffer/queries";
import * as z from "zod";

export type Auth = NonNullable<Awaited<ReturnType<typeof getAuth>>>;

/** The signed-in user's Buffer account: token, channels and organizations. */
/** What a tool reads from the saved Buffer copy. */
export type BufferView = ReturnType<typeof viewOf>;
export const viewOf = (accessToken: string, snap: Snapshot) => ({ accessToken, rateLimit: snap.rateLimit ?? [], organizationIds: snap.data.organizationIds ?? [], timeZone: snap.data.channels[0]?.timezone || snap.data.timezone || "UTC", channels: snap.data.channels, posts: snap.data.posts, fetchedAt: snap.fetchedAt, range: knownRange(snap.data, new Date()) });

/**
 * The person's Buffer copy for one tool call.
 *
 * - Default: refreshed when older than a page's refresh window. For tools whose answer is the queue itself.
 * - `force`: refreshed unless under 30 seconds old. For writes that decide on posts or channels in the copy.
 * - `stored`: the saved copy at any age, for tools that only check an id against it and then ask Buffer directly,
 *   which re-checks the person's access. Buffer's guide: "If you already stored the ID, use it"
 *   (developers.buffer.com/guides/efficient-api-usage.html). With no copy, or when `stored` is a check the copy fails (a
 *   post or organization newer than the copy), it refreshes once as `force` does.
 */
export async function bufferFor(auth: Auth, userId: string, opts: { force?: boolean; stored?: true | ((b: BufferView) => boolean) } = {}): Promise<BufferView> {
  const accessToken = await bufferAccessToken(auth, userId);
  const store = postgresSnapshotStore();
  if (opts.stored) {
    const last = await store.get(userId);
    if (last) {
      const view = viewOf(accessToken, last);
      if (opts.stored === true || opts.stored(view)) return view;
    }
  }
  const force = opts.force || !!opts.stored;
  // Reads may fall back to the last copy when Buffer cannot be reached. Writes (force) never do: they must decide
  // on current data.
  const snap = await refreshSnapshot(userId, accessToken, { store }, { force }).catch(async (e) => {
    const last = force ? null : await store.get(userId);
    if (!last) throw e;
    return last;
  });
  if (!snap) throw new Error("Could not read your Buffer account yet; try again in a minute");
  return viewOf(accessToken, snap);
}

/** For `stored`: the copy has this post. */
export const hasPost = (postId: string | undefined) => (b: BufferView) => !postId || b.posts.some((p) => p.id === postId);
/** For `stored`: the copy has this organization, or the tool was not given one. */
export const hasOrg = (organizationId: string | undefined) => (b: BufferView) => !organizationId || b.organizationIds.includes(organizationId);

/** Applies a change Buffer just accepted to the saved copy, so the next read shows it without another Buffer call. */
export async function patchSnapshot(userId: string, change: (posts: Post[]) => Post[]): Promise<void> {
  try {
    await postgresSnapshotStore().patch(userId, (s) => ({ ...s, data: { ...s.data, posts: change(s.data.posts) } }), new Date());
  } catch (e) {
    console.warn(JSON.stringify({ event: "qp-snapshot-patch-failed", message: e instanceof Error ? e.message : String(e) }));
  }
}

/** A footer the AI can pass on, so the user knows how fresh the answer is. */
export const asOf = (d: Date) => `\n(Buffer data as of ${d.toISOString().slice(0, 16).replace("T", " ")} UTC)`;

export const text = (t: string) => ({ content: [{ type: "text" as const, text: t }] });
/** A tool answer with the same facts as typed data (MCP structured content), built from the objects, never from the text. */
export const typed = <T extends Record<string, unknown>>(t: string, data: T) => ({ ...text(t), structuredContent: data });
/** A JSON answer whose object is also the typed data; its text stays the same JSON. */
export const json = <T extends Record<string, unknown>>(data: T) => typed(JSON.stringify(data), data);
/** Source content varies by source (page, feed item, transcript), so only the fields every answer shares are typed. */
export const SourceOut = z.looseObject({ status: z.string().nullish(), title: z.string().nullish(), snapshotId: z.string().nullish(), text: z.string().nullish() });

/** Templates per list_post_templates answer: about 15 KB, under the 20 KB some clients keep of a tool result. */
export const TEMPLATES_PER_ANSWER = 40;


/**
 * The text a feed item gives a draft and what kind it is: a ready transcript, else the item's own text, which for a
 * video without a transcript is only its description.
 */
export function itemText(item: { title: string; body: string; summary: string; truncated?: boolean }, transcript: TranscriptResult | null) {
  if (transcript?.status === "ready") return { body: transcript.text, title: item.title, metadata: { kind: "transcript" as const, segments: transcript.segments, captions: transcript.captions, truncated: transcript.truncated } };
  return { body: item.body || item.summary, title: transcript ? `${item.title} (video description only)` : item.title, metadata: { truncated: item.truncated, ...(transcript ? { kind: "video-description" as const } : {}) } };
}

/** Every posting slot of a week in order, channel by channel, with the post in it if any. */
export function slotRows(week: ReturnType<typeof weekFromBuffer>) {
  return week.channels.flatMap((c) =>
    Object.entries(week.slots[c.id] ?? {}).flatMap(([d, times]) => {
      const day = Number(d);
      return times.map((t) => ({ c, day, t, p: week.posts.find((x) => x.channel === c.id && x.day === day && x.time === t) }));
    }),
  );
}

/** The organization a write goes to: the one named, or the only one; null when it must be chosen. */
export function soleOrg(b: { organizationIds: string[] }, organizationId?: string): string | null {
  const org = organizationId ?? (b.organizationIds.length === 1 ? b.organizationIds[0] : undefined);
  return org && b.organizationIds.includes(org) ? org : null;
}

/** The person's organizations, for the line that asks them to choose one. */
export const orgList = (b: { organizationIds: string[] }) => b.organizationIds.join(", ") || "none found";

/** The ideas column an idea goes in, by name: its id, nothing when none was named, or why it was not found. */
export async function ideaColumn(token: string, org: string, column: string | undefined): Promise<string | undefined | { error: string }> {
  if (!column?.trim()) return undefined;
  const groups = await listIdeaGroups(token, org);
  const match = groups.find((g) => g.name.trim().toLowerCase() === column.trim().toLowerCase());
  return match ? match.id : { error: `no column named "${column}". Columns: ${groups.map((g) => g.name).join(", ") || "none"}.` };
}

/** Why Buffer refused a new idea, in words. */
export const ideaRefusal = (r: { kind: string; message: string }) => (r.kind === "limit" ? "the ideas board is at its limit" : r.message);

/** The teammates a note mentions, in order, or the ids that are not among the readable members. */
export function pickMembers(mention: string[], members: TeamMember[]): { ok: true; chosen: TeamMember[] } | { ok: false; unknown: string[] } {
  const chosen = mention.flatMap((id) => members.find((m) => m.id === id) ?? []);
  const unknown = mention.filter((id) => !members.some((m) => m.id === id));
  return unknown.length ? { ok: false, unknown } : { ok: true, chosen };
}

/** Why Buffer refused a changed note, in words. */
export function changeRefusal(r: { kind: string; message: string }, where: string, mentions: boolean): string {
  if (r.kind === "closed") return `this ${where}'s note thread is closed`;
  if (r.kind === "invalid" && mentions) return `Buffer refused the note because a mentioned teammate cannot see this ${where} (${r.message})`;
  return r.message;
}

/** Why Buffer refused a new note, in words. */
export function addRefusal(r: { kind: string; message: string }, where: string, mentions: boolean): string {
  if (r.kind === "closed") return `this ${where}'s note thread is closed`;
  if (r.kind === "limit") return "Buffer's note limit is reached";
  if (r.kind === "invalid" && mentions) return `Buffer refused the whole note because a mentioned teammate cannot see this ${where} (${r.message})`;
  return r.message;
}

/** Why Buffer refused a new tag, in words. */
export function tagRefusal(r: { kind: string; message: string }): string {
  if (r.kind === "duplicate") return "a tag with that exact name exists";
  return r.kind === "limit" ? "the organization is at its plan's tag limit" : r.message;
}

/** A channel's posting state as one word. */
export function postingWord(state: string): "ok" | "blocked" | "unknown" {
  if (state === "ok") return "ok";
  return state === "blocked" ? "blocked" : "unknown";
}

/** A channel's posting state as its line in the channel list. */
export function postingLine(p: ReturnType<typeof postingState>): string {
  if (p.state === "ok") return "posting: ok";
  if (p.state === "blocked") return `posting: ${p.status}${p.reason ? ` (${p.reason})` : ""}`;
  return "posting: not reported by Buffer";
}

/** What every group of connector tools is registered with: the server, the person, and the connected app. */
export type McpContext = {
  server: McpServer;
  auth: Auth;
  userId: string;
  websiteUrl: string;
  clientId: string;
  /** The connected app's name, looked up once per request. */
  app: () => Promise<ConnectedApp>;
  /** The connected app as the actor Security activity names. */
  byApp: () => Promise<Actor>;
};
