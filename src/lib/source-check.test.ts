import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { join } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { answering } from "./ai-test-model";
import type { Post } from "./buffer/queries";
const pg = new PGlite(); const testDb = drizzle(pg);
vi.mock("../db", () => ({ db: () => testDb }));
const ai = vi.hoisted(() => ({ model: null as unknown, calls: 0, settle: vi.fn(), available: true }));
vi.mock("./judge-model", () => ({ aiFor: async () => { ai.calls++; return ai.available ? { language: ai.model, settle: ai.settle } : null; } }));
vi.mock("./rate-limit", () => ({ limit: async () => ({ ok: true }) }));
const store = await import("./source-store");
const { reportSourceVersion, listSourcesToCheck } = await import("./source-check");
const uri = "https://example.com/release";
const draft = (id: string): Post => ({ id, channelId: "ch", text: "The price is $10.", status: "draft", dueAt: "2099-01-01", sentAt: null, externalLink: null, error: null });
let key = ""; let posts: Post[] = [];
beforeAll(async () => {
  await migrate(testDb, { migrationsFolder: join(__dirname, "../../drizzle"), migrationsTable: "__drizzle_migrations__", migrationsSchema: "public" });
  await pg.query(`insert into "user" (id,name,email) values ('owner','Owner','owner@test'),('other','Other','other@test')`);
});
beforeEach(async () => {
  key = `source-${Math.random()}`; posts = [draft(key)]; ai.calls = 0; ai.available = true; ai.settle.mockClear();
  ai.model = answering({ verdicts: [{ index: 0, holds: false, why: "The price changed to $20.", rewrite: "The price is $20." }] });
  const snapshot = await store.captureSource("owner", { sourceKey: key, uri, text: "The price is $10." });
  await store.recordEvidence("owner", key, posts[0].text, snapshot.id, [{ claim: posts[0].text, quote: posts[0].text }]);
});
afterAll(() => pg.close());
const report = (text: string, read = async () => posts) => reportSourceVersion("owner", { sourceKey: key, uri, text, checkedBy: "user" }, read);

describe("source checks through the production operation", () => {
  it("does not spend AI on unchanged evidence", async () => {
    expect(await report("The price is $10.")).toMatchObject({ changed: false, proposals: 0, pending: 0 });
    expect(ai.calls).toBe(0);
  });
  it("judges changed meaning, saves a proposal, and reuses the exact answer", async () => {
    const r = await report("The price is $20.");
    expect(r).toMatchObject({ changed: true, proposals: 1, pending: 0, checks: [{ postId: key, holds: false, rewrite: "The price is $20." }] });
    expect(posts[0].text).toBe("The price is $10.");
    expect(ai.settle).toHaveBeenCalledOnce();
    expect(await report("The price is $20.")).toMatchObject({ proposals: 1, checks: [{ postId: key, holds: false }] }); expect(ai.calls).toBe(1);
    expect((await store.sourceHoldsForPosts("owner", posts)).has(key)).toBe(true);
  });
  it("a cosmetic source change can pass without changing the draft", async () => {
    ai.model = answering({ verdicts: [{ index: 0, holds: true, why: "Only introductory wording changed." }] });
    expect(await report("Welcome. The price is $10.")).toMatchObject({ changed: true, proposals: 0 });
    expect((await store.sourceHoldsForPosts("owner", posts)).size).toBe(0);
  });
  it("incomplete answers remain retryable and cannot mark a draft checked", async () => {
    ai.model = answering({ verdicts: [] });
    expect(await report("The price is $20.")).toMatchObject({ pending: 1 });
    expect((await store.evidenceForPosts("owner", [key]))[0].judgment).toBeNull();
    await report("The price is $20."); expect(ai.calls).toBe(2);
  });
  it("a draft changed during inference discards the result", async () => {
    let calls = 0;
    const r = await report("The price is $20.", async () => ++calls === 1 ? posts : [{ ...posts[0], text: "The price is $20, paid monthly." }]);
    expect(r).toMatchObject({ pending: 1, proposals: 0 });
    expect((await store.evidenceForPosts("owner", [key]))[0].judgment).toBeNull();
  });
  it("provider failure leaves a pending source change and releases its lease", async () => {
    ai.model = answering("not valid json");
    await expect(report("The price is $20.")).rejects.toThrow();
    expect(await store.claimSourceJob("owner", `source:${key}`)).not.toBeNull();
    expect((await store.sourceHoldsForPosts("owner", posts)).has(key)).toBe(true);
  });
  it("no model leaves source checking pending", async () => {
    ai.available = false;
    expect(await report("The price is $20.")).toMatchObject({ pending: 1, proposals: 0 });
  });
  it("an outage cannot become a new source or consume AI", async () => {
    await expect(report("")).rejects.toThrow();
    expect((await store.latestSource("owner", key))?.text).toBe("The price is $10.");
    expect(ai.calls).toBe(0);
  });
  it("lists only unsent owned evidence; scheduled posts are warned about, never changed", async () => {
    expect(await listSourcesToCheck("other", posts)).toEqual([]);
    expect(await listSourcesToCheck("owner", [{ ...posts[0], status: "sent" }])).toEqual([]);
    posts[0].status = "scheduled";
    expect(await report("The price is $20.")).toMatchObject({ scheduled: [key] });
    expect(posts[0].status).toBe("scheduled");
  });
});


it("distinguishes a post awaiting Buffer approval from one already scheduled", async () => {
  posts[0].status = "needs_approval";
  expect((await report("The price is $20.")).scheduled).toEqual([]);
  const { sourceCards } = await import("./source-presentation");
  expect((await sourceCards("owner", posts))[0]).toMatchObject({ scheduled: false, editable: false });
});
