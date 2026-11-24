import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Channel, Post } from "./buffer/queries";
import type { OpenSlot } from "./open-slots";
import type { StoredRule } from "./rules-store";
import type { JudgeModel } from "./judge-model";

const mocks = vi.hoisted(() => ({ rules: vi.fn<ReturnType<typeof import("./rules-store").postgresRulesStore>["list"]>(), model: vi.fn<typeof import("./judge-model").judgeModelFor>(), judge: vi.fn<typeof import("./judge").judgeDrafts>(), save: vi.fn<typeof import("./save-drafts").saveDrafts>(), edit: vi.fn<(token: string, query: string, variables?: Record<string, unknown>) => Promise<never>>(), settle: vi.fn<import("./judge-model").JudgeModel["settle"]>() }));
vi.mock("./rules-store", () => ({ postgresRulesStore: () => ({ list: mocks.rules }) }));
vi.mock("./judge-model", () => ({ judgeModelFor: mocks.model, AiCapError: class extends Error {} }));
vi.mock("./judge", async (original) => ({ ...await original<typeof import("./judge")>(), judgeDrafts: mocks.judge }));
vi.mock("./save-drafts", () => ({ saveDrafts: mocks.save }));
import { judgeEdit, saveDraftsForUser } from "./save-for-user";
import { updateDraft } from "./edit-drafts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rules.mockResolvedValue([{ id: "b", kind: "guidance", channels: "all", level: "block", text: "No hype." } as StoredRule]);
  mocks.model.mockResolvedValue({ judges: {}, settle: mocks.settle } as unknown as JudgeModel);
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

