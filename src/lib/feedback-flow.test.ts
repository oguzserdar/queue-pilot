/**
 * @fileoverview feedbackForComment when the daily AI allowance is spent: the person gets the allowance message, not a
 * crash, and no AI is called.
 */
import { describe, expect, it, vi } from "vitest";

const planFeedback = vi.fn();
vi.mock("./review-store", () => ({ postgresReviewStore: () => ({ list: async () => [{ id: "l1", createdAt: "2026-10-31T00:00:00Z", comments: [{ id: "c1", postId: "p1", text: "Say QP", quote: null }], drafts: [{ postId: "p1", text: "Queue Pilot ships." }] }] }) }));
vi.mock("./buffer/snapshot-store", () => ({ postgresSnapshotStore: () => ({ get: async () => ({ data: { channels: [{ id: "ch1", service: "linkedin" }], posts: [{ id: "p1", status: "draft", channelId: "ch1", text: "Queue Pilot ships." }] } }) }) }));
vi.mock("./written-store", () => ({ wroteIds: async () => new Set(["p1"]) }));
vi.mock("./rules-store", () => ({ postgresRulesStore: () => ({ list: async () => [] }) }));
vi.mock("./rate-limit", () => ({ limit: async () => ({ ok: true }) }));
vi.mock("./feedback-plan", () => ({ planFeedback }));
vi.mock("./judge-model", () => {
  class AiCapError extends Error {}
  return { AiCapError, judgeModelFor: async () => { throw new AiCapError("Today's AI allowance is used up. It resets tomorrow, or add your own key in Settings."); } };
});

describe("feedbackForComment", () => {
  it("returns the allowance message when today's AI allowance is spent", async () => {
    const { feedbackForComment } = await import("./feedback-flow");
    const r = await feedbackForComment("u1", "l1", "c1", ["p1"]);
    expect(r).toEqual({ ok: false, message: "Today's AI allowance is used up. It resets tomorrow, or add your own key in Settings." });
    expect(planFeedback).not.toHaveBeenCalled();
  });
});
