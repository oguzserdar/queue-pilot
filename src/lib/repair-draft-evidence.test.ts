import { beforeEach, expect, it, vi } from "vitest";
import type { Post } from "./buffer/queries";
const replace = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./source-store", () => ({ replaceDraftEvidence: replace }));
import { repairDraftEvidence } from "./repair-draft-evidence";
const post = { id: "p", channelId: "ch", text: "Seats cost $10.", status: "draft" } as Post;
const input = { postId: "p", text: post.text, expectedText: post.text, snapshotId: "s", evidence: [{ claim: post.text, quote: "cost $10." }] };
beforeEach(() => replace.mockClear());
it("repairs the same owned draft without a Buffer mutation", async () => {
  const q = vi.fn(async () => ({ post })) as any;
  expect(await repairDraftEvidence("u", "t", input, [post], new Set(["p"]), q)).toEqual({ ok: true });
  expect(replace).toHaveBeenCalledWith("u", "p", post.text, "s", input.evidence);
  expect(q).toHaveBeenCalledTimes(1);
  expect(q.mock.calls[0][1]).toMatch(/^query /);
});
it.each(["unknown", "not-owned", "scheduled", "sent", "stale", "moved", "different-text"])("refuses %s without changing evidence", async kind => {
  const q = vi.fn(async () => ({ post: { ...post, ...(kind === "stale" ? { text: "New edit" } : {}), ...(kind === "moved" ? { channelId: "elsewhere" } : {}) } })) as any;
  const posts: Post[] = kind === "unknown" ? [] : [{ ...post, ...(kind === "scheduled" || kind === "sent" ? { status: kind } : {}) }];
  const result = await repairDraftEvidence("u", "t", { ...input, ...(kind === "different-text" ? { text: "Different text" } : {}) }, posts, new Set(kind === "not-owned" ? [] : ["p"]), q);
  expect(result.ok).toBe(false); expect(replace).not.toHaveBeenCalled();
});
