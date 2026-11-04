"use server";

/**
 * @fileoverview The draft window's tags: Buffer's own tags on a post in the signed-in person's queue. Read on any
 * post; change only on a draft Queue Pilot wrote, the same rule the AI's tag tool follows, because Buffer's edit
 * would pull a scheduled post back to drafts. Tags are always the organization's own, checked on the server.
 */
import { bufferQuery } from "@/lib/buffer/client";
import { createTag, listTags, MAX_TAG_NAME, setDraftTags } from "@/lib/buffer/tags";
import { bufferForReading } from "@/lib/current-user";
import { limit } from "@/lib/rate-limit";
import { wroteIds } from "@/lib/written-store";

/** One Buffer tag as the draft window shows it. */
export type DraftTag = { id: string; name: string; color: string };
type Result<T> = ({ ok: true } & T) | { ok: false; message: string };

const FAILED = "Buffer did not answer. Try again in a minute.";

/** The person's access to one post in their own queue, with its organization and whether they may change its tags. */
async function forPost(postId: unknown): Promise<{ ok: true; token: string; userId: string; org: string; canEdit: boolean } | { ok: false; message: string }> {
  if (typeof postId !== "string" || !postId || postId.length > 200) return { ok: false, message: "No such post." };
  const b = await bufferForReading();
  if (!b) return { ok: false, message: "Sign in with Buffer first." };
  const post = b.posts.find((p) => p.id === postId);
  if (!post) return { ok: false, message: "This post is not in your queue." };
  const org = b.channels.find((c) => c.id === post.channelId)?.organizationId;
  if (!org) return { ok: false, message: "Refresh Queue Pilot once so it knows this channel's organization." };
  const canEdit = post.status === "draft" && (await wroteIds(b.userId, postId)).has(postId);
  return { ok: true, token: b.token, userId: b.userId, org, canEdit };
}

function failure(e: unknown, event: string): { ok: false; message: string } {
  console.error(JSON.stringify({ event, message: e instanceof Error ? e.message : String(e) }));
  return { ok: false, message: FAILED };
}

const toTag = (t: { id: string; name: string; color: string }): DraftTag => ({ id: t.id, name: t.name, color: t.color });

/** The tags on one post, the organization's tags to pick from, and whether this person may change them here. */
export async function readDraftTags(postId: string): Promise<Result<{ selected: DraftTag[]; all: DraftTag[]; canEdit: boolean }>> {
  try {
    const p = await forPost(postId);
    if (!p.ok) return p;
    const [{ post }, all] = await Promise.all([
      bufferQuery<{ post: { tags: DraftTag[] } | null }>(p.token, "query PostTags($input: PostInput!) { post(input: $input) { tags { id name color } } }", { input: { id: postId } }),
      listTags(p.token, p.org),
    ]);
    return { ok: true, canEdit: p.canEdit, selected: (post?.tags ?? []).map(toTag), all: all.map(toTag) };
  } catch (e) {
    return failure(e, "qp-read-tags-failed");
  }
}

/** Sets exactly these tags on a draft Queue Pilot wrote; every id must be one of the organization's tags. */
export async function setTagsOnDraft(postId: string, tagIds: string[]): Promise<Result<object>> {
  if (!Array.isArray(tagIds) || tagIds.length > 50 || tagIds.some((t) => typeof t !== "string")) return { ok: false, message: "Pick up to 50 tags." };
  try {
    const p = await forPost(postId);
    if (!p.ok) return p;
    if (!p.canEdit) return { ok: false, message: "Only drafts Queue Pilot wrote can be tagged here. Tag this one in Buffer." };
    const known = new Set((await listTags(p.token, p.org)).map((t) => t.id));
    if (tagIds.some((t) => !known.has(t))) return { ok: false, message: "One of those tags is no longer in Buffer. Reopen the post." };
    const l = await limit("bufferWrite", p.userId);
    if (!l.ok) return { ok: false, message: `Too many requests just now. Try again in ${l.resetSeconds} seconds.` };
    const r = await setDraftTags(p.token, postId, [...new Set(tagIds)]);
    return r.ok ? { ok: true } : { ok: false, message: r.message };
  } catch (e) {
    return failure(e, "qp-set-tags-failed");
  }
}

/** Creates a tag in the post's organization, for a draft Queue Pilot wrote. Not retried: Buffer may have saved it. */
export async function createTagForDraft(postId: string, name: string): Promise<Result<{ tag: DraftTag }>> {
  const clean = typeof name === "string" ? name.trim() : "";
  if (!clean) return { ok: false, message: "Name the tag first." };
  if (clean.length > MAX_TAG_NAME) return { ok: false, message: `Keep tag names under ${MAX_TAG_NAME} characters.` };
  try {
    const p = await forPost(postId);
    if (!p.ok) return p;
    if (!p.canEdit) return { ok: false, message: "Only drafts Queue Pilot wrote can be tagged here. Tag this one in Buffer." };
    const l = await limit("bufferWrite", p.userId);
    if (!l.ok) return { ok: false, message: `Too many requests just now. Try again in ${l.resetSeconds} seconds.` };
    const r = await createTag(p.token, p.org, clean);
    if (r.ok) return { ok: true, tag: toTag(r.value) };
    return { ok: false, message: r.kind === "duplicate" ? `A tag named "${clean}" already exists.` : r.kind === "limit" ? "Your Buffer plan's tag limit is reached." : r.message };
  } catch (e) {
    return failure(e, "qp-create-tag-failed");
  }
}
