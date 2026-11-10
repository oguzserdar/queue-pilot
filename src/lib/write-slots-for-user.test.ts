import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { Brief, BriefMaterial } from "./ai-writer";
const m = vi.hoisted(() => ({ material: [] as BriefMaterial[], transcript: vi.fn(), capture: vi.fn(), write: vi.fn(), save: vi.fn(), giveBack: vi.fn(), settle: vi.fn() }));
vi.mock("./new-material", () => ({ newMaterial: async () => m.material }));
vi.mock("./open-slots", () => ({ openSlots: () => ({ slots: ["a", "b"].map(id => ({ id, at: "2026-11-02T09:00:00Z", channelId: "ch", service: "twitter", channel: "Personal", local: "Mon 9:00" })) }) }));
vi.mock("./transcript-for-user", () => ({ transcriptForUser: m.transcript }));
vi.mock("./source-store", () => ({ captureSource: m.capture }));
vi.mock("./ai-writer", () => ({ writeDrafts: m.write }));
vi.mock("./save-for-user", () => ({ PLAYBOOK_REFUSAL: "Breaks your playbook", checkNote: () => undefined, saveDraftsForUser: (...args: unknown[]) => m.save(...args) }));
vi.mock("./voice-store", () => ({ postgresVoiceStore: () => ({ get: async () => ({ note: null, examples: [] }) }) }));
vi.mock("./rules-store", () => ({ postgresRulesStore: () => ({ list: async () => [] }) }));
vi.mock("./judge-model", () => ({ AiCapError: class extends Error {}, aiFor: async () => ({ cfg: { provider: "anthropic" }, giveBack: m.giveBack, settle: m.settle }) }));
const { writeSlotsForUser } = await import("./write-slots-for-user");
const load = async () => ({ userId: "u", token: "t", channels: [], posts: [], timeZone: "UTC", range: { start: new Date(), end: new Date() } });
beforeEach(() => {
 vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-01T12:00:00Z")); vi.resetAllMocks();
 m.material = [{ key: "video", title: "Video", url: "https://youtube.com/watch?v=abcdefghijk", text: "Video description." }];
 m.capture.mockResolvedValue({ id: "snap" }); m.transcript.mockResolvedValue({ status: "not-configured" });
 m.write.mockImplementation(async (_model, b: Brief) => b.slots.map(s => ({ slotId: s.id, text: "Draft", sourceKey: b.material[0].key })));
 m.save.mockImplementation(async (_u, _t, i) => ({ saved: i.drafts.map((d: { slotId: string }) => ({ ...d, local: "Mon", channel: "Personal" })), refused: [], flags: [], check: "judged" }));
});
afterEach(() => vi.useRealTimers());
it.each(["not-configured", "unavailable", "out-of-credits"])("keeps video description when transcript is %s", async status => {
 m.transcript.mockResolvedValue({ status });
 expect(await writeSlotsForUser(load)).toMatchObject({ ok: true, saved: [{}, {}] });
 expect(m.capture).toHaveBeenCalledWith("u", expect.objectContaining({ text: "Video description." }), expect.objectContaining({ kind: "video-description" }));
});
it("leaves a pending video unused for resumption", async () => {
 m.transcript.mockResolvedValue({ status: "pending", jobId: "j" });
 expect(await writeSlotsForUser(load)).toMatchObject({ ok: false }); expect(m.write).not.toHaveBeenCalled(); expect(m.giveBack).toHaveBeenCalled();
});
it("skips one unavailable snapshot and reports why while saving other material", async () => {
 m.material.push({ key: "good", title: "Blog", url: "https://example.com", text: "Blog text" });
 m.capture.mockRejectedValueOnce(new Error("Source busy"));
 const r = await writeSlotsForUser(load);
 expect(r).toMatchObject({ ok: true, saved: [{}, {}] });
 expect(r.ok && r.note).toContain("Video"); expect(m.write.mock.calls[0][1].material).toHaveLength(1);
});
it("reports invalid source associations instead of dropping drafts silently", async () => {
 m.write.mockResolvedValue([{ slotId: "a", text: "Draft", sourceKey: "unknown" }]);
 expect(await writeSlotsForUser(load)).toMatchObject({ ok: true, saved: [], refused: [expect.objectContaining({ slotId: "a" })] });
 expect(m.giveBack).toHaveBeenCalledOnce();
});
it("retains saved results when the rewrite returns an invalid source", async () => {
 m.save.mockResolvedValueOnce({ saved: [{ slotId: "a", local: "Mon", channel: "Personal" }], refused: [{ slotId: "b", reason: "Breaks your playbook: hype" }], flags: [], check: "judged" });
 m.write.mockResolvedValueOnce([{ slotId: "a", text: "A", sourceKey: "video" }, { slotId: "b", text: "B", sourceKey: "video" }]).mockResolvedValueOnce([{ slotId: "b", text: "B2", sourceKey: "wrong" }]);
 expect(await writeSlotsForUser(load)).toMatchObject({ ok: true, saved: [{ channel: "Personal" }], refused: [expect.objectContaining({ slotId: "b" })] });
});
it("returns the action when source-context processing cannot finish, and saves no partial drafts", async () => {
 const { SourceContextError } = await import("./source-context");
 m.write.mockRejectedValue(new SourceContextError("Choose a model with a larger context window. The full source is still saved."));
 expect(await writeSlotsForUser(load)).toMatchObject({ ok: false, message: expect.stringContaining("larger context window") });
 expect(m.save).not.toHaveBeenCalled(); expect(m.giveBack).toHaveBeenCalledOnce(); expect(m.settle).toHaveBeenCalledOnce();
});
it("gives the action back and says the AI took too long when the writing call times out", async () => {
 // What production logged on 9 Nov: the writing call hit its time limit and the person saw a generic failure.
 m.write.mockRejectedValue(new DOMException("The operation was aborted due to timeout", "TimeoutError"));
 expect(await writeSlotsForUser(load)).toMatchObject({ ok: false, message: expect.stringContaining("took too long") });
 expect(m.save).not.toHaveBeenCalled(); expect(m.giveBack).toHaveBeenCalledOnce();
});
