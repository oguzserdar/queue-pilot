import { beforeEach, expect, it, vi } from "vitest";
import type { OpenSlot } from "./open-slots";
const m = vi.hoisted(() => ({ latest: vi.fn(), capture: vi.fn(), byId: vi.fn(), record: vi.fn(), owned: vi.fn(), get: vi.fn(), save: vi.fn() }));
vi.mock("./source-store", () => ({ latestSource: m.latest, captureSource: m.capture, sourceById: m.byId, recordEvidence: m.record }));
vi.mock("./material-store", () => ({ postgresMaterialStore: () => ({ get: m.get }) }));
vi.mock("./rules-store", () => ({ postgresRulesStore: () => ({ list: async () => [] }) }));
vi.mock("./sources-store", () => ({ postgresSourceStore: () => ({ list: async () => [], markUsed: async () => {} }) }));
vi.mock("./written-store", () => ({ postgresWrittenStore: () => ({ record: m.owned }) }));
vi.mock("./buffer/snapshot-store", () => ({ postgresSnapshotStore: () => ({ get: async () => null }) }));
vi.mock("./save-drafts", () => ({ saveDrafts: m.save }));
const { saveDraftsForUser } = await import("./save-for-user");
const open = ["a", "b"].map(id => ({ id, service: "twitter" }) as OpenSlot);
const draft = (slotId = "a") => ({ slotId, text: "The limit is 500." });
beforeEach(() => {
 vi.resetAllMocks(); m.record.mockResolvedValue(undefined); m.owned.mockResolvedValue(undefined); m.latest.mockResolvedValue(null);
 m.get.mockImplementation(async (_u, key) => ({ key, text: "The limit is 500.", title: "Release", link: "https://example.com" }));
 m.capture.mockImplementation(async (_u, i) => ({ id: i.sourceKey, text: i.text, metadata: {} }));
 m.byId.mockResolvedValue({ id: "snap", text: "The limit is 500.", metadata: {} });
 m.save.mockImplementation(async (_t, i) => ({ saved: i.drafts.map((d: { slotId: string; text: string }) => ({ ...d, postId: d.slotId, network: "twitter" })), refused: [], requests: 1 }));
});
it("captures an owned material key when an older caller has not read it first", async () => {
 const r = await saveDraftsForUser("u", "t", { title: "Old client", drafts: [draft()], open, sourceKeys: ["material:" + "a".repeat(64)] });
 expect(r.saved).toHaveLength(1); expect(m.capture).toHaveBeenCalledOnce(); expect(m.record).toHaveBeenCalledOnce();
 expect(r.flags[0].verdict).toBe("unsure");
});
it("records ambiguous older multi-source saves as unchecked instead of refusing the batch", async () => {
 const r = await saveDraftsForUser("u", "t", { title: "Old client", drafts: [draft()], open, sourceKeys: ["material:" + "a".repeat(64), "material:" + "b".repeat(64)] });
 expect(r.saved).toHaveLength(1); expect(m.record).toHaveBeenCalledTimes(2); expect(r.flags.length).toBeGreaterThan(0);
});
it("does not lose other drafts when one evidence claim is absent from its draft", async () => {
 const r = await saveDraftsForUser("u", "t", { title: "Bad citation", open, drafts: [ { ...draft(), snapshotId: "snap", evidence: [{ claim: "Something else", quote: "The limit is 500." }] }, draft("b") ] });
 expect(r.saved).toHaveLength(2); expect(r.flags).toContainEqual(expect.objectContaining({ slotId: "a", verdict: "unsure" }));
});
it("saves unresolved legacy material with a warning but never grants approval ownership", async () => {
 m.get.mockResolvedValue(null);
 const r = await saveDraftsForUser("u", "t", { title: "Missing", drafts: [draft()], open, sourceKeys: ["material:" + "a".repeat(64)] });
 expect(r.saved).toHaveLength(1); expect(r.flags[0].verdict).toBe("unsure"); expect(m.owned).toHaveBeenCalledWith("u", []);
});
it("still rejects a supplied snapshot from another account before writing", async () => {
 m.byId.mockResolvedValue(null);
 await expect(saveDraftsForUser("u", "t", { title: "Foreign", drafts: [{ ...draft(), snapshotId: "foreign" }], open })).rejects.toThrow("not in this account"); expect(m.save).not.toHaveBeenCalled();
});
// 11 Nov 2026: an AI drafted posts from a person's inbox. A draft like that names no source, and it used to be saved
// with no word about it.
const NO_SOURCE = { rule: "Source evidence", verdict: "unsure", reason: "No source. This draft cites nothing saved in Queue Pilot. Check where it came from before approving.", quote: "" };
it("saves a draft that cites nothing, and says it has no source", async () => {
 const r = await saveDraftsForUser("u", "t", { title: "From the chat", drafts: [draft(), draft("b")], open });
 expect(r.saved).toHaveLength(2); expect(r.refused).toEqual([]);
 expect(r.flags).toEqual([{ slotId: "a", ...NO_SOURCE }, { slotId: "b", ...NO_SOURCE }]);
});
it("does not flag a draft the person typed themselves in the app", async () => {
 const r = await saveDraftsForUser("u", "t", { title: "Written in Queue Pilot", drafts: [draft()], open, byHand: true });
 expect(r.saved).toHaveLength(1); expect(r.flags).toEqual([]);
});
it("does not call a draft unsourced when it carries a source and a matching quote", async () => {
 const r = await saveDraftsForUser("u", "t", { title: "Release", open, drafts: [{ ...draft(), snapshotId: "snap", evidence: [{ claim: "The limit is 500.", quote: "The limit is 500." }] }] });
 expect(r.saved).toHaveLength(1); expect(r.flags).toEqual([]);
});
it("keeps the material-key warning for a draft that names a key, without also calling it unsourced", async () => {
 const r = await saveDraftsForUser("u", "t", { title: "Old client", drafts: [draft()], open, sourceKeys: ["material:" + "a".repeat(64)] });
 expect(r.flags.length).toBeGreaterThan(0); expect(r.flags.map(f => f.reason)).not.toContain(NO_SOURCE.reason);
});
it("says nothing about the source of a draft that was not saved", async () => {
 m.save.mockResolvedValue({ saved: [], refused: [{ slotId: "a", reason: "That time is no longer empty." }], requests: 1 });
 const r = await saveDraftsForUser("u", "t", { title: "From the chat", drafts: [draft()], open });
 expect(r.saved).toEqual([]); expect(r.flags).toEqual([]);
});
