/**
 * @fileoverview Security activity paging on real Postgres (PGlite) with the real migrations: pages follow a bookmark,
 * never repeat or skip a line, including events recorded in the same millisecond, and a bad bookmark opens the newest
 * page.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
vi.mock("../db", () => ({ db: () => testDb, schema: {} }));

const { securityEventPage } = await import("./security-events");

beforeAll(async () => {
  await pg.query(`insert into "user" (id, name, email) values ('a', 'a', 'a@x'), ('b', 'b', 'b@x')`);
  // 30 events: 12 in the same millisecond (microseconds apart), the rest a minute apart, plus one for someone else.
  for (let i = 0; i < 30; i++) {
    const at = i < 12 ? `2026-11-10 03:10:00.123${String(100 + i).padStart(3, "0")}+00` : `2026-11-10 02:${String(59 - i).padStart(2, "0")}:00+00`;
    await pg.query(`insert into qp_security_event (id, user_id, event, detail, created_at) values ($1, 'a', 'draft_deleted', $2, $3)`, [`e${String(i).padStart(2, "0")}`, JSON.stringify({ n: String(i) }), at]);
  }
  await pg.query(`insert into qp_security_event (id, user_id, event, created_at) values ('other', 'b', 'sign_in', now())`);
});
afterAll(async () => { await pg.close(); });

describe("security activity pages", () => {
  it("walks every event once, newest first, across pages", async () => {
    const seen: string[] = [];
    let before: string | null = null;
    let pages = 0;
    do {
      const page: Awaited<ReturnType<typeof securityEventPage>> = await securityEventPage("a", { before }, 7);
      seen.push(...page.events.map((e) => e.detail!.n));
      before = page.older;
      pages++;
    } while (before && pages < 10);
    expect(pages).toBe(5);
    expect(seen).toEqual(Array.from({ length: 30 }, (_, i) => String(i <= 11 ? 11 - i : i)));
  });

  it("says there is no older page on the last one", async () => {
    const page = await securityEventPage("a", {}, 30);
    expect(page.events).toHaveLength(30);
    expect(page.older).toBeNull();
    expect(page.newer).toBeNull();
  });

  it("walks back with Newer to exactly the pages it came through, ending on the newest", async () => {
    const p1 = await securityEventPage("a", {}, 7);
    const p2 = await securityEventPage("a", { before: p1.older }, 7);
    const p3 = await securityEventPage("a", { before: p2.older }, 7);
    expect(p1.newer).toBeNull();
    expect(p3.newer).not.toBeNull();
    const back2 = await securityEventPage("a", { after: p3.newer }, 7);
    expect(back2.events).toEqual(p2.events);
    const back1 = await securityEventPage("a", { after: back2.newer }, 7);
    expect(back1.events).toEqual(p1.events);
    expect(back1.newer).toBeNull();
    expect(back1.older).toBe(p1.older);
  });

  it("opens the newest page for a bookmark that is not one", async () => {
    for (const bad of ["nonsense", "~e01", "2026-11-10~", "'; drop table x;--~e01"]) {
      const page = await securityEventPage("a", { before: bad }, 3);
      expect(page.events.map((e) => e.detail!.n)).toEqual(["11", "10", "9"]);
    }
  });

  it("never shows another person's events", async () => {
    const page = await securityEventPage("a", {}, 100);
    expect(page.events.some((e) => e.event === "sign_in")).toBe(false);
  });
});
