import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sourceHash, sourceVersionInput, verifyEvidence } from "./source-evidence";
const pg = await migratedPglite();
const testDb = drizzle(pg);
vi.mock("../db", () => ({ db: () => testDb }));
const store = await import("./source-store");
beforeAll(async () => {
  await pg.query(`insert into "user" (id,name,email) values ('owner','Owner','owner@test'),('other','Other','other@test')`);
});
afterAll(() => pg.close());
const input = (key: string, text = "Seats cost $10.") => ({ sourceKey: key, uri: "https://example.com/release", text });

describe("source evidence on Postgres", () => {
  it("normalizes whitespace without changing the words and refuses empty input but retains long sources", () => {
    expect(sourceHash("a \n b")).toBe(sourceHash("a b"));
    expect(sourceHash("a b")).not.toBe(sourceHash("A b"));
    expect(sourceVersionInput.safeParse(input("a", " ")).success).toBe(false);
    expect(sourceVersionInput.safeParse(input("a", "a".repeat(200_001))).success).toBe(true);
  });
  it("verifies actual quotes and locators, never invented timestamps", () => {
    const e = { claim: "Seats cost $10.", quote: "cost $10.", locator: "t=12" };
    expect(verifyEvidence(e.claim, e.claim, e)).toEqual({ ...e, locator: null });
    expect(verifyEvidence(e.claim, e.claim, e, { segments: [{ text: e.claim, seconds: 12.2 }] }).locator).toBe("t=12");
    expect(verifyEvidence(e.claim, "Seats cost $20.", e).quote).toBeNull();
    expect(verifyEvidence("A different draft", e.claim, e)).toMatchObject({ quote: null, locator: null });
  });
  it("deduplicates identical reports but preserves original versions", async () => {
    const first = await store.captureSource("owner", input("dedup"));
    const same = await store.captureSource("owner", input("dedup", " Seats  cost $10. "));
    const next = await store.captureSource("owner", input("dedup", "Seats cost $20."));
    expect(same.id).toBe(first.id); expect(next.id).not.toBe(first.id);
    expect((await store.sourceById("owner", first.id))?.text).toBe("Seats cost $10.");
    expect(await store.sourceById("other", first.id)).toBeNull();
  });
  it("never lets a later partial read replace an existing full source", async () => {
    const first = await store.captureSource("owner", input("partial"));
    await expect(store.captureSource("owner", input("partial", "Seats"), { truncated: true })).rejects.toThrow("previous full source was kept");
    expect((await store.latestSource("owner", "partial"))?.id).toBe(first.id);
  });
  it("only one concurrent worker owns a source, and stale workers cannot save or release", async () => {
    const key = "source:race";
    const old = (await store.claimSourceJob("owner", key))!;
    expect(await store.claimSourceJob("owner", key)).toBeNull();
    await pg.query("update qp_source_job set expires_at = now() - interval '1 second' where key = $1", [key]);
    const next = (await store.claimSourceJob("owner", key))!;
    await store.releaseSourceJob("owner", key, old);
    expect(await store.claimSourceJob("owner", key)).toBeNull();
    await expect(store.appendSource("owner", input("race"), "user", old)).rejects.toThrow();
    await store.appendSource("owner", input("race"), "user", next);
    await store.releaseSourceJob("owner", key, next);
  });
  it("keeps evidence private and holds changed drafts and changed source versions", async () => {
    const first = await store.captureSource("owner", input("linked"));
    await expect(store.recordEvidence("other", "p", first.text, first.id, [{ claim: first.text, quote: first.text }])).rejects.toThrow();
    await store.recordEvidence("owner", "p", first.text, first.id, [{ claim: first.text, quote: first.text }]);
    expect(await store.evidenceForPosts("other", ["p"])).toEqual([]);
    expect((await store.sourceHoldsForPosts("owner", [{ id: "p", text: first.text }])).size).toBe(0);
    expect((await store.sourceHoldsForPosts("owner", [{ id: "p", text: "Seats cost $30." }])).has("p")).toBe(true);
    const latest = await store.captureSource("owner", input("linked", "Seats now cost $20."));
    expect((await store.sourceHoldsForPosts("owner", [{ id: "p", text: first.text }])).has("p")).toBe(true);
    const token = (await store.claimSourceJob("owner", "source:linked"))!;
    const [row] = await store.evidenceForPosts("owner", ["p"]);
    await store.saveSourceJudgment("owner", "linked", token, row, { snapshotId: latest.id, draftText: first.text, holds: true, why: "A historical statement remains true.", checkedAt: new Date().toISOString() });
    expect((await store.sourceHoldsForPosts("owner", [{ id: "p", text: first.text }])).size).toBe(0);
    expect((await store.sourceHoldsForPosts("owner", [{ id: "p", text: "A later edit" }])).has("p")).toBe(true);
    await store.releaseSourceJob("owner", "source:linked", token);
  });
  it("persists and resumes a transcript job and fences a late completion", async () => {
    const key = "transcript:video";
    const token = (await store.claimSourceJob("owner", key))!;
    await store.saveTranscriptJob("owner", key, token, "job-123");
    expect((await store.pendingTranscriptJob("owner", key))?.value.jobId).toBe("job-123");
    expect(await store.pendingTranscriptJob("other", key)).toBeNull();
    await store.releaseSourceJob("owner", key, "wrong");
    expect((await store.pendingTranscriptJob("owner", key))?.value.jobId).toBe("job-123");
  });
});

it("lease renewal cannot revive an expired claim or extend its successor", async () => {
 const key = "source:renew";
 const old = (await store.claimSourceJob("owner", key))!;
 await pg.query("update qp_source_job set expires_at = now() - interval '1 second' where key = $1", [key]);
 await expect(store.renewSourceJob("owner", key, old)).rejects.toThrow();
 const current = (await store.claimSourceJob("owner", key))!;
 await expect(store.renewSourceJob("owner", key, old)).rejects.toThrow();
 await expect(store.renewSourceJob("owner", key, current)).resolves.toBeUndefined();
});

it("does not replace a saved transcript with a fallback video description", async () => {
 const first = await store.captureSource("owner", input("video-kind"), { kind: "transcript", captions: "unknown" });
 await expect(store.captureSource("owner", input("video-kind", "Video description"), { kind: "video-description" })).rejects.toThrow("description cannot replace");
 expect((await store.latestSource("owner", "video-kind"))?.id).toBe(first.id);
});

it("upgrades old partial coverage and caption metadata when full text has the same hash", async () => {
 const first = await store.captureSource("owner", input("coverage-upgrade", "Complete transcript."), { kind: "transcript", truncated: true, excerptWindow: "prefix-12000" });
 const full = await store.captureSource("owner", input("coverage-upgrade", "Complete transcript."), { kind: "transcript", truncated: false, segments: [{ text: "Complete transcript.", seconds: 12 }] });
 expect(full.id).toBe(first.id); expect(full.metadata.truncated).toBe(false); expect(full.metadata.excerptWindow).toBeUndefined(); expect(full.metadata.segments).toHaveLength(1);
});

it("repairs invalid claims atomically, preserves other sources, and cannot cross accounts", async () => {
 const s = await store.captureSource("owner", input("repair", "Seats cost $10."));
 const other = await store.captureSource("owner", input("repair-other", "Doors open at 9."));
 const draft = "Seats cost $10. Doors open at 9.";
 await store.recordEvidence("owner", "repair-p", draft, s.id, [{ claim: "A ticket is ten dollars", quote: "Seats cost $10." }]);
 await store.recordEvidence("owner", "repair-p", draft, other.id, [{ claim: "Doors open at 9.", quote: "Doors open at 9." }]);
 const valid = [{ claim: "Seats cost $10.", quote: "cost $10." }];
 await expect(store.replaceDraftEvidence("other", "repair-p", draft, s.id, valid)).rejects.toThrow("not in this account");
 await expect(store.replaceDraftEvidence("owner", "unknown-p", draft, s.id, valid)).rejects.toThrow("not attached");
 await expect(store.replaceDraftEvidence("owner", "repair-p", draft, s.id, [...valid, { claim: "paraphrased", quote: "cost $10." }])).rejects.toThrow("exact draft");
 expect((await store.evidenceForPosts("owner", ["repair-p"])).find(e => e.snapshotId === s.id)?.quote).toBeNull();
 await store.replaceDraftEvidence("owner", "repair-p", draft, s.id, valid);
 const rows = await store.evidenceForPosts("owner", ["repair-p"]);
 expect(rows).toHaveLength(2); expect(rows.find(e => e.snapshotId === s.id)?.quote).toBe("cost $10.");
 expect(rows.find(e => e.snapshotId === other.id)?.quote).toBe("Doors open at 9.");
 await store.captureSource("owner", input("repair", "Seats cost $20."));
 await expect(store.replaceDraftEvidence("owner", "repair-p", draft, s.id, valid)).rejects.toThrow("outdated");
});

it("citation repair retains a failed meaning check and shares the source-check lease", async () => {
 const s = await store.captureSource("owner", input("repair-failed"));
 const evidence = [{ claim: s.text, quote: s.text }];
 await store.recordEvidence("owner", "failed-p", s.text, s.id, evidence);
 const token = (await store.claimSourceJob("owner", "source:repair-failed"))!;
 const [row] = await store.evidenceForPosts("owner", ["failed-p"]);
 await store.saveSourceJudgment("owner", "repair-failed", token, row, { snapshotId: s.id, draftText: s.text, holds: false, why: "Later passage contradicts it.", checkedAt: new Date().toISOString() });
 await expect(store.replaceDraftEvidence("owner", "failed-p", s.text, s.id, evidence)).rejects.toThrow("already being checked");
 await store.releaseSourceJob("owner", "source:repair-failed", token);
 await store.replaceDraftEvidence("owner", "failed-p", s.text, s.id, evidence);
 expect((await store.sourceHoldsForPosts("owner", [{ id: "failed-p", text: s.text }])).get("failed-p")).toBe("Later passage contradicts it.");
});
