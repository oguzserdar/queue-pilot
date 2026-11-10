/**
 * @fileoverview Unit tests for settling drafts the writer recorded but never marked.
 * @module lib/fill-recovery.test
 */
import { describe, expect, it, vi } from "vitest";
import { recoverFillDrafts, SETTLE_AFTER_MS, settleFillDrafts, type OpenFillDraft } from "./fill-recovery";
import type { Post } from "./buffer/queries";

const now = new Date("2026-11-10T12:00:00Z");
const old = new Date(now.getTime() - SETTLE_AFTER_MS - 1);
const slotId = "ch@2026-11-16T14:06:00.000Z";
const row = (over: Partial<OpenFillDraft> = {}): OpenFillDraft => ({ runId: "run", slotId, text: "Soup night.", callStartedAt: old, updatedAt: old, ...over });
const post = (over: Partial<Post> = {}): Post => ({ id: "p1", channelId: "ch", status: "draft", text: "Soup night.", dueAt: "2026-11-16T14:06:00.000Z", sentAt: null, externalLink: null, error: null, ...over });

describe("settleFillDrafts", () => {
  it("adopts the draft Buffer holds on that time with the same text", () => {
    expect(settleFillDrafts([row()], [post()], now)).toEqual([{ runId: "run", slotId, kind: "adopt", postId: "p1" }]);
  });
  it("reads the time as a moment, so a different spelling of the same instant still matches", () => {
    expect(settleFillDrafts([row()], [post({ dueAt: "2026-11-16T07:06:00-07:00" })], now)[0].kind).toBe("adopt");
  });
  it("never adopts a draft with other text, another channel's post, or a post that is no longer a draft", () => {
    for (const p of [post({ text: "Something else." }), post({ channelId: "other" }), post({ status: "scheduled" })])
      expect(settleFillDrafts([row()], [p], now)[0].kind).toBe("fail");
  });
  it("says the time is still empty when Buffer never confirmed and holds nothing there", () => {
    expect(settleFillDrafts([row()], [], now)).toEqual([{ runId: "run", slotId, kind: "fail", reason: expect.stringContaining("did not confirm") }]);
  });
  it("says the run stopped when the save was never started", () => {
    expect(settleFillDrafts([row({ callStartedAt: null })], [], now)[0]).toMatchObject({ kind: "fail", reason: expect.stringContaining("run stopped") });
  });
  it("treats a failed post on that time as an empty time", () => {
    expect(settleFillDrafts([row()], [post({ status: "error", text: "Old." })], now)[0]).toMatchObject({ reason: expect.stringContaining("still empty") });
  });
  it("leaves a record alone while its run may still be going", () => {
    expect(settleFillDrafts([row({ updatedAt: new Date(now.getTime() - 60_000) })], [post()], now)).toEqual([]);
  });
});

describe("recoverFillDrafts", () => {
  it("records an adopted draft as ours before marking its record, and marks the rest failed", async () => {
    const order: string[] = [];
    const other = "ch@2026-11-17T14:06:00.000Z";
    const deps = { open: async () => [row(), row({ slotId: other })], record: vi.fn(async () => { order.push("record"); }), settle: vi.fn(async () => { order.push("settle"); }) };
    expect(await recoverFillDrafts("u", [post()], () => "twitter", deps, now)).toBe(2);
    expect(order).toEqual(["record", "settle"]);
    expect(deps.record).toHaveBeenCalledWith("u", [{ postId: "p1", network: "twitter", text: "Soup night.", verdicts: null }]);
    expect(deps.settle).toHaveBeenCalledWith("u", [expect.objectContaining({ slotId, kind: "adopt" }), expect.objectContaining({ slotId: other, kind: "fail" })]);
  });
  it("writes nothing when there is nothing to settle", async () => {
    const deps = { open: async () => [], record: vi.fn(), settle: vi.fn() };
    expect(await recoverFillDrafts("u", [], () => "twitter", deps, now)).toBe(0);
    expect(deps.record).not.toHaveBeenCalled(); expect(deps.settle).not.toHaveBeenCalled();
  });
});
