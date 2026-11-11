/**
 * @fileoverview The long lists paged by bookmark, on real Postgres (PGlite) with the real migrations: review links,
 * Telegram and Discord posts, and saved research. Each walk visits every row once, newest first, and walks back.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
vi.mock("../db", () => ({ db: () => testDb, schema: {} }));

const { postgresReviewStore } = await import("./review-store");
const { directPostPage } = await import("./direct-post-store");
const { postgresMaterialStore } = await import("./material-store");
import type { Page, PageFrom } from "./page-bookmark";

// Eight rows a minute apart, the newest first in the walk; two share one microsecond-different instant.
const at = (i: number) => (i < 2 ? `2026-11-10 03:10:00.12345${i}+00` : `2026-11-10 02:${String(50 - i).padStart(2, "0")}:00+00`);

beforeAll(async () => {
  await pg.query(`insert into "user" (id, name, email) values ('a', 'a', 'a@x'), ('b', 'b', 'b@x')`);
  for (let i = 0; i < 8; i++) {
    await pg.query(`insert into qp_review_link (id, user_id, drafts, created_at) values ($1, 'a', '[]', $2)`, [`r${i}`, at(i)]);
    await pg.query(`insert into qp_announcement_send (announcement_id, user_id, kind, target, label, text, status, created_at, updated_at) values ($1, 'a', $2, '-100', 'x', 'y', 'sent', $3, $3)`, [`p${Math.floor(i / 2)}`, i % 2 ? "discord" : "telegram", at(i)]);
    await pg.query(`insert into qp_material (user_id, key, title, text, added_at) values ('a', $1, 't', 'x', $2)`, [`m${i}`, at(i)]);
  }
  await pg.query(`insert into qp_review_link (id, user_id, drafts) values ('other', 'b', '[]')`);
});
afterAll(async () => { await pg.close(); });

async function walk<R>(read: (from: PageFrom) => Promise<Page<R>>, id: (r: R) => string) {
  const pages: Page<R>[] = [];
  let before: string | null = null;
  do { const p: Page<R> = await read({ before }); pages.push(p); before = p.older; } while (before && pages.length < 10);
  const back = await read({ after: pages.at(-1)!.newer });
  return { ids: pages.flatMap((p) => p.rows.map(id)), pages: pages.length, backMatches: back.rows.map(id).join() === pages.at(-2)!.rows.map(id).join() };
}

describe("long lists paged by bookmark", () => {
  it("pages review links, only the person's own", async () => {
    const r = await walk((f) => postgresReviewStore().page("a", f, 3), (l) => l.id);
    expect(r).toEqual({ ids: ["r1", "r0", "r2", "r3", "r4", "r5", "r6", "r7"], pages: 3, backMatches: true });
  });

  it("pages Telegram and Discord posts by post and place", async () => {
    const r = await walk((f) => directPostPage("a", f, 3), (p) => `${p.postId}:${p.kind}`);
    expect(r.ids).toHaveLength(8);
    expect(new Set(r.ids).size).toBe(8);
    expect(r.backMatches).toBe(true);
  });

  it("pages saved research", async () => {
    const r = await walk((f) => postgresMaterialStore().list("a", f, 3), (m) => m.key);
    expect(r).toEqual({ ids: ["m1", "m0", "m2", "m3", "m4", "m5", "m6", "m7"], pages: 3, backMatches: true });
  });
});
