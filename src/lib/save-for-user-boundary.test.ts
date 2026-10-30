import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, Post } from "./buffer/queries";
import type { OpenSlot } from "./open-slots";

const mocks = vi.hoisted(() => ({ rules: vi.fn(), model: vi.fn(), judge: vi.fn(), save: vi.fn(), edit: vi.fn(), settle: vi.fn() }));
vi.mock("./rules-store", () => ({ postgresRulesStore: () => ({ list: mocks.rules }) }));
vi.mock("./judge-model", () => ({ judgeModelFor: mocks.model, AiCapError: class extends Error {} }));
vi.mock("./judge", async (original) => ({ ...await original<typeof import("./judge")>(), judgeDrafts: mocks.judge }));
vi.mock("./save-drafts", () => ({ saveDrafts: mocks.save }));
import { judgeEdit, saveDraftsForUser } from "./save-for-user";
import { updateDraft } from "./edit-drafts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rules.mockResolvedValue([{ id: "b", kind: "guidance", channels: "all", level: "block", text: "No hype." }]);
  mocks.model.mockResolvedValue({ judges: {}, settle: mocks.settle });
  mocks.judge.mockResolvedValue(new Map());
});

describe("mandatory checks at the Buffer write boundary", () => {
  it.each(["unreadable", "no-model", "failed", "missing-answer"])("makes no create or update call when checking is %s", async (failure) => {
    if (failure === "unreadable") mocks.rules.mockRejectedValue(new Error("Storage unavailable"));
    if (failure === "no-model") mocks.model.mockResolvedValue(null);
    if (failure === "failed") mocks.judge.mockRejectedValue(new Error("Provider unavailable"));
    const saved = await saveDraftsForUser("person", "token", {
      title: "Draft", drafts: [{ slotId: "slot", text: "A draft." }], open: [{ id: "slot", service: "twitter" } as OpenSlot],
    });
    expect(saved.saved).toEqual([]);
    expect(saved.refused).toHaveLength(1);
    expect(mocks.save).not.toHaveBeenCalled();

    const changed = await updateDraft("token", "ours", "An edit.",
      [{ id: "ours", status: "draft", channelId: "channel" } as Post],
      [{ id: "channel", service: "twitter" } as Channel], new Set(["ours"]), mocks.edit,
      async (text, network) => (await judgeEdit("person", text, network)).refusal);
    expect(changed.ok).toBe(false);
    expect(mocks.edit).not.toHaveBeenCalled();
  });
});
