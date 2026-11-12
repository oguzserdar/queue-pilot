/**
 * @fileoverview What Queue Pilot wrote stays what it wrote. A later check of the person's edited text is kept beside
 * it, so the edit stays visible as an edit and the same-fix offer can find it.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Real Postgres (PGLite) with the real migrations, behind the app's Drizzle client.
const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
vi.mock("../db", () => ({ db: () => testDb, schema: {} }));

const { postgresWrittenStore, checkedTextOf } = await import("./written-store");
const { editsFrom } = await import("./fix-offers");

beforeAll(async () => {
  await pg.query(`insert into "user" (id, name, email) values ('u1', 'a', 'a@x'), ('u2', 'b', 'b@x')`);
});
afterAll(async () => { await pg.close(); });

describe("the written record", () => {
  it("keeps what Queue Pilot wrote after the person's edit is checked, so the edit is still found", async () => {
    const store = postgresWrittenStore();
    await store.record("u1", [{ postId: "p1", network: "twitter", text: "Big news: our release is out. #AI", verdicts: [], playbookRevision: "r1" }]);
    // The person removes the hashtag in the app and presses Check again.
    const edited = "Big news: our release is out.";
    await store.recordCheck("u1", [{ postId: "p1", text: edited, verdicts: [], playbookRevision: "r1" }]);
    const [w] = await store.get("u1", ["p1"]);
    expect(w.text).toBe("Big news: our release is out. #AI");
    expect(checkedTextOf(w)).toBe(edited);
    expect(editsFrom([w], [{ id: "p1", text: edited }])).toEqual([expect.objectContaining({ before: "Big news: our release is out. #AI", after: edited })]);
  });

  it("checks the text that is in Buffer now: a fresh save counts as checked for its own text", async () => {
    const store = postgresWrittenStore();
    await store.record("u1", [{ postId: "p2", network: "twitter", text: "Hello", verdicts: [], playbookRevision: "r1" }]);
    const [w] = await store.get("u1", ["p2"]);
    expect(checkedTextOf(w)).toBe("Hello");
  });

  it("only records a check on a draft this person's Queue Pilot wrote", async () => {
    const store = postgresWrittenStore();
    await store.record("u2", [{ postId: "p3", network: "twitter", text: "Theirs", verdicts: [], playbookRevision: "r1" }]);
    await store.recordCheck("u1", [{ postId: "p3", text: "Hijacked", verdicts: [], playbookRevision: "r1" }]);
    const [w] = await store.get("u2", ["p3"]);
    expect(checkedTextOf(w)).toBe("Theirs");
    expect(await store.get("u1", ["p3"])).toEqual([]);
  });
});
