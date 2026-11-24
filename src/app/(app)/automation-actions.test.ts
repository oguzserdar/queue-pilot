/**
 * @fileoverview Settings actions for reply automations: signed out is refused, the store's answers become plain words,
 * and the person's own id is always the one used.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ id: "u1" as string | null }));
const lib = vi.hoisted(() => ({ saveAutomation: vi.fn<typeof import("@/lib/reply-automation-store").saveAutomation>(), deleteAutomation: vi.fn<typeof import("@/lib/reply-automation-store").deleteAutomation>() }));
vi.mock("@/lib/current-user", () => ({ signedInUserId: async () => user.id }));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/reply-automation-store", () => lib);
const { saveAutomationAction, deleteAutomationAction } = await import("./automation-actions");

beforeEach(() => { user.id = "u1"; lib.saveAutomation.mockReset(); lib.deleteAutomation.mockReset(); });

describe("automation actions", () => {
  it("refuses a signed-out visitor without touching the store", async () => {
    user.id = null;
    expect((await saveAutomationAction({})).ok).toBe(false);
    expect((await deleteAutomationAction("a")).ok).toBe(false);
    expect(lib.saveAutomation).not.toHaveBeenCalled();
  });

  it("saves for the signed-in person and says why a save failed", async () => {
    lib.saveAutomation.mockResolvedValueOnce({ ok: true, id: "auto_1" });
    expect(await saveAutomationAction({ x: 1 })).toEqual({ ok: true, message: "Automation saved.", id: "auto_1" });
    expect(lib.saveAutomation).toHaveBeenCalledWith("u1", { x: 1 });
    lib.saveAutomation.mockResolvedValueOnce({ ok: false, error: "invalid", message: "A fixed reply needs at least one version." });
    expect(await saveAutomationAction({})).toEqual({ ok: false, message: "A fixed reply needs at least one version." });
    lib.saveAutomation.mockResolvedValueOnce({ ok: false, error: "not-found" });
    expect((await saveAutomationAction({})).message).toMatch(/no longer/);
  });

  it("deletes only through the signed-in person's id", async () => {
    lib.deleteAutomation.mockResolvedValueOnce(true);
    expect((await deleteAutomationAction("auto_1")).ok).toBe(true);
    expect(lib.deleteAutomation).toHaveBeenCalledWith("u1", "auto_1");
  });
});
