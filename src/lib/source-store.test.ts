import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sourceHash, sourceVersionInput, verifyEvidence } from "./source-evidence";
const pg = new PGlite();
const testDb = drizzle(pg);
vi.mock("../db", () => ({ db: () => testDb }));
const store = await import("./source-store");
beforeAll(async () => {
  await migrate(testDb, { migrationsFolder: join(__dirname, "../../drizzle"), migrationsTable: "__drizzle_migrations__", migrationsSchema: "public" });
  await pg.query(`insert into "user" (id,name,email) values ('owner','Owner','owner@test'),('other','Other','other@test')`);
});
afterAll(() => pg.close());
const input = (key: string, text = "Seats cost $10.") => ({ sourceKey: key, uri: "https://example.com/release", text });

describe("source evidence on Postgres", () => {
  it("normalizes whitespace without changing the words and refuses empty or overlong input", () => {
    expect(sourceHash("a \n b")).toBe(sourceHash("a b"));
    expect(sourceHash("a b")).not.toBe(sourceHash("A b"));
    expect(sourceVersionInput.safeParse(input("a", " ")).success).toBe(false);
    expect(sourceVersionInput.safeParse(input("a", "a".repeat(20_001))).success).toBe(false);
  });
  it("verifies actual quotes and locators, never invented timestamps", () => {
    const e = { claim: "Seats cost $10.", quote: "cost $10.", locator: "t=12" };
    expect(verifyEvidence(e.claim, e.claim, e)).toEqual({ ...e, locator: null });
    expect(verifyEvidence(e.claim, e.claim, e, { segments: [{ text: e.claim, seconds: 12.2 }] }).locator).toBe("t=12");
    expect(verifyEvidence(e.claim, "Seats cost $20.", e).quote).toBeNull();
    expect(() => verifyEvidence("A different draft", e.claim, e)).toThrow();
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
