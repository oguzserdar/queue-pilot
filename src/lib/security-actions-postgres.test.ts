/**
 * @fileoverview Recorded actions on real Postgres (PGlite) with the real migrations: each consequential action is
 * stored with who did it and only ids and counts, and "Connected <app>" is recorded only once the approval exists.
 */
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const pg = new PGlite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
vi.mock("../db", () => ({ db: () => testDb, schema: {} }));

const { recordAction, recentSecurityEvents, ACTION_EVENTS } = await import("./security-events");
const { recordAppConnected, connectedApp } = await import("./ai-access");
const { showSecurityEvent } = await import("./security-event-words");
const { approverLine, approverFor } = await import("./rule-origin");

beforeAll(async () => {
  await migrate(testDb, { migrationsFolder: join(__dirname, "../../drizzle"), migrationsTable: "__drizzle_migrations__", migrationsSchema: "public" });
  await pg.query(`insert into "user" (id, name, email) values ('a', 'a', 'a@x'), ('b', 'b', 'b@x')`);
});
afterAll(async () => { await pg.close(); });

describe("recorded actions on real Postgres", () => {
  it.each(ACTION_EVENTS.filter((k) => k !== "app_connected"))("records %s with the app's name and ids, never text", async (kind) => {
    await recordAction("a", kind, { via: "ai", app: "Claude" }, { ids: ["p1", "p2"] });
    const [latest] = await recentSecurityEvents("a", 1);
    expect(latest.event).toBe(kind);
    expect(latest.detail).toEqual({ by: "Claude", via: "ai", count: "2", ids: "p1,p2" });
  });

  it("records the app's own buttons as Queue Pilot, and keeps each person's events apart", async () => {
    await recordAction("b", "drafts_approved", { via: "app" }, { ids: ["x"] });
    const [latest] = await recentSecurityEvents("b", 1);
    expect(latest.detail).toEqual({ by: "Queue Pilot", via: "app", count: "1", ids: "x" });
    expect((await recentSecurityEvents("a")).some((e) => e.detail?.ids === "x")).toBe(false);
  });

  it("caps the ids kept on one event", async () => {
    const ids = Array.from({ length: 40 }, (_, i) => `p${i}`);
    await recordAction("a", "drafts_approved", { via: "ai", app: "Claude" }, { ids });
    const [latest] = await recentSecurityEvents("a", 1);
    expect(latest.detail?.count).toBe("40");
    expect(latest.detail?.ids.split(",")).toHaveLength(25);
  });

  it("records a connected app only once its approval exists, under its brand name", async () => {
    await recordAppConnected("b", "https://claude.ai/oauth/mcp-oauth-client-metadata");
    expect((await recentSecurityEvents("b")).some((e) => e.event === "app_connected")).toBe(false);
    await pg.query(`insert into oauth_client (id, client_id, name, redirect_uris) values ('cb', 'https://claude.ai/oauth/mcp-oauth-client-metadata', 'Claude', '{https://claude.ai/cb}')`);
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values ('kb', 'https://claude.ai/oauth/mcp-oauth-client-metadata', 'b', '{openid}', now(), now())`);
    await recordAppConnected("b", "https://claude.ai/oauth/mcp-oauth-client-metadata");
    const connected = (await recentSecurityEvents("b")).find((e) => e.event === "app_connected");
    expect(connected?.detail).toEqual({ by: "Claude", via: "ai" });
  });

  it.each(["claude", " CLAUDE ", "queue-pilot", "Queue Pilot"])("records a self-named app %j as unverified everywhere", async (name) => {
    const id = `dcr-${encodeURIComponent(name)}`;
    await pg.query(`insert into oauth_client (id, client_id, name, redirect_uris) values ($1, $1, $2, '{https://attacker.example/cb}')`, [id, name]);
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values ($1, $2, 'a', '{openid}', now(), now())`, [`k-${id}`, id]);
    const app = await connectedApp(id);
    expect(app).toEqual({ name: name.trim(), verified: false });
    await recordAppConnected("a", id);
    const [connected] = await recentSecurityEvents("a", 1);
    expect(showSecurityEvent(connected).what).toBe(`Connected an unverified app named "${name.trim()}"`);
    await recordAction("a", "draft_deleted", { via: "ai", app: app.name, verified: app.verified }, { ids: ["p1"] });
    const [deleted] = await recentSecurityEvents("a", 1);
    expect(showSecurityEvent(deleted).where).toBe(`By an unverified app named "${name.trim()}"`);
    expect(approverLine(approverFor(app))).toBe(`Approved through an unverified app named "${name.trim()}"`);
  });

  it("keeps the brand for a client proven by its registered address", async () => {
    expect(await connectedApp("https://claude.ai/oauth/mcp-oauth-client-metadata")).toEqual({ name: "Claude", verified: true });
    await pg.query(`insert into oauth_client (id, client_id, name, redirect_uris) values ('dcr-real', 'dcr-real', 'ChatGPT', '{https://chatgpt.com/connector_platform_oauth_redirect}')`);
    const app = await connectedApp("dcr-real");
    expect(app).toEqual({ name: "ChatGPT", verified: true });
    expect(approverLine(approverFor(app))).toBe("Approved through ChatGPT");
  });

  it("caps a long self-declared name", async () => {
    await pg.query(`insert into oauth_client (id, client_id, name, redirect_uris) values ('dcr-long', 'dcr-long', $1, '{https://attacker.example/cb}')`, ["x".repeat(500)]);
    const app = await connectedApp("dcr-long");
    expect(app.verified).toBe(false);
    expect(Array.from(app.name)).toHaveLength(60);
    expect(app.name.endsWith("…")).toBe(true);
  });
});
