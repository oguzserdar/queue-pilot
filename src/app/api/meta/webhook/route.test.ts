/**
 * @fileoverview The Meta webhook route on the real migrated database: the one-time verification, a refused signature
 * before any database work, a comment stored once with a private reply queued for the sweeper, and events dropped for
 * accounts with replies off or from before replies were turned on.
 */
import { createHmac } from "node:crypto";
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.stubEnv("DATABASE_URL", "postgres://test@localhost/unused");
vi.stubEnv("META_APP_SECRET", "app-secret");
vi.stubEnv("META_WEBHOOK_VERIFY_TOKEN", "verify-me");
const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("@/db/schema")), ...(await import("@/db/auth-schema")) } });
vi.mock("@/db", () => ({ db: () => testDb, hasDatabase: () => true }));
const { GET, POST } = await import("./route");
const { clearOperatorSettingsCache } = await import("@/lib/env");

const IG = "17841400000000001";
const comment = (id: string, at: number, from = "9001") => JSON.stringify([{ object: "instagram", entry: [{ id: IG, time: at, field: "comments", value: { id, from: { id: from, username: "ana" }, text: "price?", media: { id: "post-1" } } }] }]);
const send = (body: string, sig = `sha256=${createHmac("sha256", "app-secret").update(body).digest("hex")}`) =>
  POST(new Request("https://qp.example/api/meta/webhook", { method: "POST", body, headers: { "x-hub-signature-256": sig } }));
const count = async (sql: string) => Number((await pg.query<{ n: string }>(sql)).rows[0].n);
const T = Math.floor(new Date("2026-11-15T10:00:00Z").getTime() / 1000);

beforeEach(async () => {
  clearOperatorSettingsCache();
  for (const t of ["qp_message", "qp_conversation", "qp_contact_identifier", "qp_contact", "qp_social_account"]) await pg.query(`delete from ${t}`);
  await pg.query(`insert into "user" (id, name, email) values ('u1', 'Ada', 'ada@w.example') on conflict do nothing`);
  await pg.query(`insert into qp_social_account (id, user_id, network, account_id, handle, server, credentials, replies_on, replies_since) values ('ig-1', 'u1', 'instagram', $1, 'ada', 'https://graph.instagram.com', 'x', true, $2)`, [IG, new Date((T - 60) * 1000)]);
});
afterAll(async () => { await pg.close(); vi.unstubAllEnvs(); });

describe("GET /api/meta/webhook", () => {
  it("answers Meta's verification with the challenge only for the right token", async () => {
    const ok = await GET(new Request(`https://qp.example/api/meta/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=1158201444`));
    expect(ok.status).toBe(200);
    expect(await ok.text()).toBe("1158201444");
    const bad = await GET(new Request(`https://qp.example/api/meta/webhook?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1`));
    expect(bad.status).toBe(403);
  });
});

describe("POST /api/meta/webhook", () => {
  it("refuses a bad signature with 401 and stores nothing", async () => {
    const res = await send(comment("c1", T), "sha256=00");
    expect(res.status).toBe(401);
    expect(await count(`select count(*) as n from qp_message`)).toBe(0);
  });

  it("stores a comment once, even when Meta sends it twice, and queues no reply while no Instagram sender exists", async () => {
    expect((await send(comment("c1", T))).status).toBe(200);
    expect((await send(comment("c1", T))).status).toBe(200);
    expect(await count(`select count(*) as n from qp_message where direction = 'in'`)).toBe(1);
    // A queued reply nothing can send would sit undecided until it aged out; it is queued once the sender is wired.
    expect(await count(`select count(*) as n from qp_message where direction = 'out'`)).toBe(0);
  });

  it("drops a comment from before replies were turned on, and events for an account with replies off", async () => {
    expect((await send(comment("c-old", T - 3600))).status).toBe(200);
    await pg.query(`update qp_social_account set replies_on = false, replies_since = null`);
    expect((await send(comment("c-off", T))).status).toBe(200);
    expect(await count(`select count(*) as n from qp_message`)).toBe(0);
  });
});
