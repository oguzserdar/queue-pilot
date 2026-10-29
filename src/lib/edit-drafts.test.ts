import { describe, expect, it, vi } from "vitest";
import type { Channel, Post } from "./buffer/queries";
import { deleteDraft, updateDraft } from "./edit-drafts";

const channels = [{ id: "x", name: "X", service: "twitter" }] as Channel[];
const post = (id: string, status: Post["status"], via: Post["via"] = "api"): Post => ({ id, channelId: "x", status, text: "old", dueAt: "2026-11-02T09:00:00Z", via }) as Post;
const posts = [post("d1", "draft"), post("s1", "scheduled"), post("t1", "sent")];
/** Post ids Queue Pilot recorded writing (written-store). */
const wrote = new Set(["d1", "s1", "t1"]);

describe("updateDraft", () => {
  it("edits only the text of the caller's own draft and keeps it a draft", async () => {
    const q = vi.fn().mockResolvedValue({ editPost: { __typename: "PostActionSuccess" } });
    expect(await updateDraft("tok", "d1", "new text", posts, channels, wrote, q)).toEqual({ ok: true });
    expect(q.mock.calls[0][2]).toEqual({ input: { id: "d1", text: "new text", saveToDraft: true } });
  });
  it("refuses scheduled, sent and unknown posts without calling Buffer", async () => {
    const q = vi.fn();
    for (const id of ["s1", "t1", "someone-elses"]) expect((await updateDraft("tok", id, "x", posts, channels, wrote, q)).ok).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });
  it("refuses text over the network's limit without calling Buffer", async () => {
    const q = vi.fn();
    expect((await updateDraft("tok", "d1", "a".repeat(400), posts, channels, wrote, q)).ok).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });
  it("refuses a change the playbook check refuses, before anything reaches Buffer", async () => {
    const q = vi.fn();
    const gate = vi.fn(async () => 'Breaks your playbook: "Never Excited to share" (found "Ravi di condividere").');
    const res = await updateDraft("tok", "d1", "Ravi di condividere v2", posts, channels, wrote, q, gate);
    expect(res).toMatchObject({ ok: false });
    expect(!res.ok && res.reason).toContain("Ravi di condividere");
    expect(gate).toHaveBeenCalledWith("Ravi di condividere v2", expect.any(String));
    expect(q).not.toHaveBeenCalled();
  });
  it("passes Buffer's own refusal on", async () => {
    const q = vi.fn().mockResolvedValue({ editPost: { __typename: "InvalidInputError", message: "Text is required" } });
    expect(await updateDraft("tok", "d1", "x", posts, channels, wrote, q)).toEqual({ ok: false, reason: "Text is required" });
  });
});

describe("deleteDraft", () => {
  it("deletes only a draft", async () => {
    const q = vi.fn().mockResolvedValue({ deletePost: { __typename: "DeletePostSuccess" } });
    expect(await deleteDraft("tok", "d1", posts, wrote, q)).toEqual({ ok: true });
    expect(q.mock.calls[0][2]).toEqual({ input: { id: "d1" } });
    const never = vi.fn();
    expect((await deleteDraft("tok", "s1", posts, wrote, never)).ok).toBe(false);
    const refused = vi.fn().mockResolvedValue({ deletePost: { __typename: "VoidMutationError", message: "Post not found" } });
    expect(await deleteDraft("tok", "d1", posts, wrote, refused)).toEqual({ ok: false, reason: "Post not found" });
    expect(never).not.toHaveBeenCalled();
  });
});

describe("drafts the person wrote themselves", () => {
  // A default parameter would turn an explicit undefined back into "api", so the post with no via is built by hand.
  const noVia = { id: "n1", channelId: "x", status: "draft", text: "old", dueAt: "2026-11-02T09:00:00Z" } as Post;
  const mine = [post("h1", "draft", "buffer"), noVia];
  it("are never changed or deleted, and Buffer is not called", async () => {
    const q = vi.fn();
    for (const id of ["h1", "n1"]) {
      const edit = await updateDraft("tok", id, "new text", mine, channels, wrote, q);
      const del = await deleteDraft("tok", id, mine, wrote, q);
      expect(edit.ok).toBe(false);
      expect(del.ok).toBe(false);
    }
    expect(q).not.toHaveBeenCalled();
  });
});

describe("drafts another app wrote through Buffer's API", () => {
  // Buffer marks every API-made post via "api", including Zapier's or n8n's. Only Queue Pilot's own record counts.
  const other = [post("z1", "draft", "api")];
  it("are never changed or deleted, and Buffer is not called", async () => {
    const q = vi.fn();
    const edit = await updateDraft("tok", "z1", "new text", other, channels, wrote, q);
    const del = await deleteDraft("tok", "z1", other, wrote, q);
    expect(edit).toEqual({ ok: false, reason: expect.stringMatching(/Queue Pilot did not write/) });
    expect(del.ok).toBe(false);
    expect(q).not.toHaveBeenCalled();
  });
});
