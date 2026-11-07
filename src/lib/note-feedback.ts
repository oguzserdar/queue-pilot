/**
 * @fileoverview Teammates' Buffer notes on the person's open posts, turned into rules for one account.
 *
 * A note is someone else's untrusted text: it is shown with its author and the post it is on, never followed. Reading
 * the notes costs one Buffer request per organization and no AI. Proposing changes for one note reads Buffer again (so
 * a deleted or edited note is not acted on), classifies it with the same planner as review comments, previews the
 * Queue Pilot drafts on that note's account that would change, and offers a preference only as a rule for that one
 * account, with the note recorded as its origin. Facts and one-off edits never become rules.
 */
import { createHash } from "node:crypto";
import { listOpenWithNotes, type Channel, type Post } from "./buffer/queries";
import { channelsByOrganization } from "./day-one-rules";
import { wroteIds } from "./written-store";
import { checkedFeedback, type FeedbackResult } from "./feedback-flow";

/** One note on an open post, as the finder and the connector show it. */
export type TeamNote = {
  /** Stable for this note on this post; pass it back to propose changes. */
  key: string;
  postId: string;
  channelId: string;
  /** The account's name in Buffer. */
  account: string;
  network: string;
  /** The post the note was written on. */
  post: string;
  /** The note's author, or null when Buffer has no name for them. */
  author: string | null;
  at: string | null;
  text: string;
};

/** The most notes one read returns, newest first. */
export const MAX_NOTES = 10;

type NoteBuffer = { token: string; channels: Channel[]; posts: Post[] };

/**
 * A note's key names its account (channel), so proposing changes for it reads that one account's open posts again
 * instead of every organization's, and finds the note however many newer notes arrived since it was listed.
 */
const noteKey = (channelId: string, postId: string, at: string | null, text: string) => `note:${channelId}:${createHash("sha256").update(JSON.stringify([postId, at, text])).digest("hex").slice(0, 32)}`;
/** The account (channel) a note key names, or null when the key is not one. */
const channelOfKey = (key: string): string | null => key.match(/^note:([^:]+):[0-9a-f]{32}$/)?.[1] ?? null;

/**
 * The notes people wrote on the person's open posts (drafts, posts waiting for approval, scheduled), newest first.
 *
 * @param b - The person's Buffer: token and channels
 * @param read - The Buffer reader, replaceable in tests
 */
export async function teamNotes(b: Pick<NoteBuffer, "token" | "channels">, read = listOpenWithNotes): Promise<TeamNote[]> {
  return (await allTeamNotes(b, read)).slice(0, MAX_NOTES);
}

/**
 * Every note on the person's open posts, newest first, with no count limit: keeping a note rule checks its note
 * against this, so an older note past the first MAX_NOTES still counts as present.
 *
 * @param b - The person's Buffer: token and channels
 * @param read - The Buffer reader, replaceable in tests
 */
export async function allTeamNotes(b: Pick<NoteBuffer, "token" | "channels">, read = listOpenWithNotes): Promise<TeamNote[]> {
  const posts = (await Promise.all([...channelsByOrganization(b.channels)].map(([org, ids]) => read(b.token, org, ids)))).flat();
  return notesOn(posts, b.channels);
}

/** The non-empty notes on these posts, newest first, each with its post and account; posts on unknown accounts are left out. */
function notesOn(posts: Awaited<ReturnType<typeof listOpenWithNotes>>, channels: Channel[]): TeamNote[] {
  const byId = new Map(channels.map((c) => [c.id, c]));
  return posts
    .flatMap((p) => {
      const c = byId.get(p.channelId);
      return c ? p.notes.filter((n) => n.text.trim()).map((n) => ({ key: noteKey(p.channelId, p.id, n.at, n.text), postId: p.id, channelId: p.channelId, account: c.name, network: c.service, post: p.text.slice(0, 5000), author: n.by, at: n.at, text: n.text.trim().slice(0, 5000) })) : [];
    })
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
}

/** The words a kept note rule records as its origin: "a note from Sam on 2026-11-01". */
export const noteOrigin = (n: Pick<TeamNote, "author" | "at">) => `a note from ${n.author ?? "a teammate"}${n.at ? ` on ${n.at.slice(0, 10)}` : ""}`;

/**
 * Proposes changes for one note: reads the notes again, and plans against the Queue Pilot drafts still on that note's
 * account. A preference comes back as a suggestion for that account only.
 *
 * @param loadBuffer - Reads the person's Buffer now (the open posts' notes are always read live)
 * @param key - A note key from teamNotes
 */
export async function feedbackForNote(userId: string, loadBuffer: () => Promise<NoteBuffer>, key: unknown, read = listOpenWithNotes): Promise<{ ok: true; note: TeamNote; drafts: { id: string; label: string }[]; plan: FeedbackResult } | { ok: false; message: string }> {
  const channelId = typeof key === "string" && key.length <= 200 ? channelOfKey(key) : null;
  if (!channelId) return { ok: false, message: "Choose a note from the list." };
  const b = await loadBuffer();
  // Read only the note's own account, live: the note is found on its thread whatever its age, and a note that was
  // changed or deleted, or an account no longer connected, is refused.
  const account = b.channels.find((c) => c.id === channelId && c.organizationId);
  const note = account ? notesOn(await read(b.token, account.organizationId!, [channelId]), [account]).find((n) => n.key === key) : undefined;
  if (!note) return { ok: false, message: "That note is no longer on an open post in Buffer. Read the notes again." };
  const channels = new Map(b.channels.map((c) => [c.id, c]));
  const candidates = b.posts.filter((p) => p.status === "draft" && p.channelId === note.channelId);
  const ours = await wroteIds(userId, ...candidates.map((p) => p.id));
  // Only Queue Pilot's own drafts on that one account can change; another account is never touched.
  const drafts = candidates.filter((p) => ours.has(p.id)).slice(0, 30);
  const r = await checkedFeedback(userId, { text: note.text, quote: null, original: note.post }, drafts, channels, (preference, reason) => ({
    key: `note:${createHash("sha256").update(JSON.stringify([note.key, preference])).digest("hex")}`,
    rule: { kind: "guidance", text: preference, channels: "all", accountIds: [note.channelId], level: "warn" },
    evidence: { kind: "note", note: note.text, author: note.author, at: note.at, postId: note.postId, channelId: note.channelId, account: note.account, network: note.network, origin: noteOrigin(note), reason },
  }));
  const c = channels.get(note.channelId);
  const label = (p: Post) => `${c?.name ?? note.account}${p.dueAt ? `, ${new Date(p.dueAt).toLocaleString("en-GB", { weekday: "long", hour: "2-digit", minute: "2-digit", timeZone: c?.timezone || "UTC" })}` : ""}`;
  return r.ok ? { ok: true, note, drafts: drafts.map((p) => ({ id: p.id, label: label(p) })), plan: r.plan } : r;
}
