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
