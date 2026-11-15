/**
 * @fileoverview Moving a scheduled post back to draft in Buffer: what is sent, and what is refused.
 */
import { describe, expect, it, vi } from "vitest";
import { moveToDraft } from "./edit-drafts";

/** A fake Buffer that answers the post read with `status` and records every mutation input. */
function buffer(status: string, editAnswer: Record<string, unknown> = { __typename: "PostActionSuccess", post: { id: "p1", status: "draft" } }) {
  const edits: unknown[] = [];
  const q = vi.fn<(t: string, query: string, vars: { input: unknown }) => Promise<unknown>>(async (_t: string, query: string, vars: { input: unknown }) => {
    if (query.includes("editPost")) { edits.push(vars.input); return { editPost: editAnswer }; }
    return { post: { id: "p1", channelId: "ch", text: "Hello", status } };
  });
  return { q: q as never, edits };
}

describe("moveToDraft", () => {
  it("sends only the id and saveToDraft for a scheduled post", async () => {
    const b = buffer("scheduled");
    expect(await moveToDraft("t", "p1", b.q)).toEqual({ ok: true });
    expect(b.edits).toEqual([{ id: "p1", saveToDraft: true }]);
  });
  it.each(["sent", "sending", "error", "draft"])("refuses a post that is %s, and sends nothing", async (status) => {
    const b = buffer(status);
    expect((await moveToDraft("t", "p1", b.q)).ok).toBe(false);
    expect(b.edits).toEqual([]);
  });
  it("shows Buffer's own refusal", async () => {
    const b = buffer("scheduled", { __typename: "InvalidInputError", message: "Text is too long for X" });
    expect(await moveToDraft("t", "p1", b.q)).toEqual({ ok: false, reason: "Text is too long for X" });
  });
  it("lets an AI app move only posts Queue Pilot wrote", async () => {
    const b = buffer("scheduled");
    expect((await moveToDraft("t", "p1", b.q, new Set(["other"]))).ok).toBe(false);
    expect(b.edits).toEqual([]);
    expect((await moveToDraft("t", "p1", b.q, new Set(["p1"]))).ok).toBe(true);
  });
});
