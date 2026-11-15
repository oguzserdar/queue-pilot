/**
 * @fileoverview Cooldowns on Postgres with the real migrations: a shorter wait never shortens a longer one, an ended
 * wait is not active, and the same Mastodon account connected by two people is one key (one limit).
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { encryptSecret } from "./secrets";

const master = "c".repeat(64);
vi.stubEnv("SETTINGS_KEY", master);
const pg = await migratedPglite();
const testDb = drizzle(pg);
vi.mock("../db", () => ({ db: () => testDb }));
const { cooldownKey, postgresCooldowns } = await import("./cooldowns");

const T = new Date("2026-11-15T12:00:00Z");
const plus = (ms: number) => new Date(T.getTime() + ms);

beforeAll(async () => {
  await pg.query(`insert into "user" (id, name, email) values ('u1','a','a@x'),('u2','b','b@x')`);
  const creds = encryptSecret(JSON.stringify({ token: "t" }), master);
  await pg.query(`insert into qp_social_account (id, user_id, network, account_id, handle, server, credentials) values
    ('a1','u1','mastodon','1090','@ada@m.example','https://m.example',$1),
    ('a2','u2','mastodon','1090','@ada@m.example','https://M.example/',$1),
    ('a3','u1','mastodon','2000','@bob@m.example','https://m.example',$1)`, [creds]);
});
afterAll(async () => { await pg.close(); });

describe("postgres cooldowns", () => {
  const c = postgresCooldowns();
  it("keeps the longer of two waits, and an ended wait is not active", async () => {
    await c.note("k1", plus(600_000));
    await c.note("k1", plus(60_000));
    expect(await c.active("k1", T)).toEqual(plus(600_000));
    expect(await c.active("k1", plus(700_000))).toBeNull();
  });

  it("gives one key to the same Mastodon account connected by two people, and another to a different account", async () => {
    const item = (target: string) => ({ kind: "mastodon" as const, target, label: "", text: "" });
    const k1 = await cooldownKey(item("a1"), "u1"), k2 = await cooldownKey(item("a2"), "u2"), k3 = await cooldownKey(item("a3"), "u1");
    expect(k1).toBe(k2);
    expect(k3).not.toBe(k1);
    expect(await cooldownKey(item("a1"), "u2")).toBeNull();
  });
});

describe("Discord waits for the whole bot", async () => {
  const { DiscordError } = await import("./discord");
  const { DISCORD_BOT } = await import("./cooldowns");
  const c = postgresCooldowns();
  it("notes a global refusal on the bot-wide key and a route refusal on its channel", () => {
    expect(c.wider!("discord channel c1", new DiscordError("slow", 5, true))).toBe(DISCORD_BOT);
    expect(c.wider!("discord channel c1", new DiscordError("slow", 5, false))).toBeNull();
    expect(c.wider!("mastodon https://m.example 1", new DiscordError("slow", 5, true))).toBeNull();
  });
  it("checks the bot-wide key for every Discord channel, never for other networks", () => {
    expect(c.wider!("discord channel c2")).toBe(DISCORD_BOT);
    expect(c.wider!("telegram chat -100")).toBeNull();
  });
});
