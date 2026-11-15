/**
 * @fileoverview Replies on one network account: when two people connect the same Mastodon or Bluesky account, only one
 * of them can have replies on at a time, so no mention is ever answered twice. Turning replies on records when, so a
 * mention from before that moment is never answered.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.stubEnv("DATABASE_URL", "postgres://test@localhost/unused");
const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: await import("@/db/schema") });
vi.mock("@/db", () => ({ db: () => testDb }));
const { setReplies } = await import("./social-accounts");

const on = async (id: string) => (await pg.query<{ replies_on: boolean; replies_since: Date | null }>(`select replies_on, replies_since from qp_social_account where id = $1`, [id])).rows[0];

beforeEach(async () => {
  await pg.query(`delete from qp_social_account`);
  await pg.query(`insert into "user" (id, name, email) values ('ada', 'Ada', 'ada@r.example'), ('bob', 'Bob', 'bob@r.example') on conflict do nothing`);
  await pg.query(`insert into qp_social_account (id, user_id, network, account_id, handle, server, credentials) values
    ('a1', 'ada', 'mastodon', '42', '@team@m.example', 'https://m.example', 'x'),
    ('b1', 'bob', 'mastodon', '42', '@team@m.example', 'https://m.example', 'x'),
    ('b2', 'bob', 'mastodon', '43', '@bob@m.example', 'https://m.example', 'x')`);
});
afterAll(async () => { await pg.close(); });

describe("setReplies", () => {
  it("turns replies on for the person's own account and records when", async () => {
    expect(await setReplies("ada", "a1", true, new Date("2026-11-15T10:00:00Z"))).toBe("ok");
    expect(await on("a1")).toMatchObject({ replies_on: true, replies_since: new Date("2026-11-15T10:00:00Z") });
  });

  it("refuses a second person turning replies on for the same network account", async () => {
    expect(await setReplies("ada", "a1", true)).toBe("ok");
    expect(await setReplies("bob", "b1", true)).toBe("taken");
    expect((await on("b1")).replies_on).toBe(false);
    expect(await setReplies("bob", "b2", true)).toBe("ok");
  });

  it("frees the account when the first person turns replies off", async () => {
    await setReplies("ada", "a1", true);
    expect(await setReplies("ada", "a1", false)).toBe("ok");
    expect((await on("a1")).replies_since).toBeNull();
    expect(await setReplies("bob", "b1", true)).toBe("ok");
  });

  it("answers not-found for an account that is not the person's", async () => {
    expect(await setReplies("bob", "a1", true)).toBe("not-found");
    expect((await on("a1")).replies_on).toBe(false);
  });

  it("changes nothing when replies are turned on again: same start time, same read position", async () => {
    expect(await setReplies("ada", "a1", true, new Date("2026-11-15T10:00:00Z"))).toBe("ok");
    await pg.query(`insert into qp_reply_cursor (account_id, user_id, primed_at, cursor, polled_at) values ('a1', 'ada', now(), '555', now())`);
    expect(await setReplies("ada", "a1", true, new Date("2026-11-15T11:00:00Z"))).toBe("ok");
    expect((await on("a1")).replies_since).toEqual(new Date("2026-11-15T10:00:00Z"));
    expect((await pg.query(`select cursor from qp_reply_cursor where account_id = 'a1'`)).rows).toEqual([{ cursor: "555" }]);
  });

  it("treats the same Mastodon account number on two different servers as two accounts", async () => {
    await pg.query(`insert into qp_social_account (id, user_id, network, account_id, handle, server, credentials) values ('evil', 'bob', 'mastodon', '42', '@x@evil.example', 'https://evil.example', 'x')`);
    expect(await setReplies("bob", "evil", true)).toBe("ok");
    expect(await setReplies("ada", "a1", true)).toBe("ok");
  });

  it("gives one Bluesky account one replier, even when two people have it stored under different servers", async () => {
    await pg.query(`insert into qp_social_account (id, user_id, network, account_id, handle, server, credentials) values
      ('bs-ada', 'ada', 'bluesky', 'did:plc:same', 'x.bsky.social', 'https://pds-a.example', 'x'),
      ('bs-bob', 'bob', 'bluesky', 'did:plc:same', 'x.bsky.social', 'https://bsky.social', 'x')`);
    expect(await setReplies("ada", "bs-ada", true)).toBe("ok");
    expect(await setReplies("bob", "bs-bob", true)).toBe("taken");
  });

  it("treats a Mastodon server written with other letter case or a trailing slash as the same server", async () => {
    await pg.query(`insert into qp_social_account (id, user_id, network, account_id, handle, server, credentials) values ('m-bob', 'bob', 'mastodon', '42', '@ada@m.example', 'HTTPS://M.Example/', 'x')`);
    expect(await setReplies("ada", "a1", true)).toBe("ok");
    expect(await setReplies("bob", "m-bob", true)).toBe("taken");
  });
});
