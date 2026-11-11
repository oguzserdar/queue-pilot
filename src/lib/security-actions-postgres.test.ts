/**
 * @fileoverview Recorded actions on real Postgres (PGlite) with the real migrations: each consequential action is
 * stored with who did it and only ids and counts, and "Connected <app>" is recorded only once the approval exists.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
vi.mock("../db", () => ({ db: () => testDb, schema: {} }));

const { recordAction, recentSecurityEvents, ACTION_EVENTS } = await import("./security-events");
const { recordAppConnected, connectedApp, revokeApp } = await import("./ai-access");
const { showSecurityEvent } = await import("./security-event-words");
const { approverLine, approverFor } = await import("./rule-origin");

beforeAll(async () => {
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
    expect(approverLine(approverFor(app))).toBe(`Last approved through Queue Pilot: by an unverified app named "${name.trim()}"`);
  });

  it("keeps the brand for a client proven by its registered address", async () => {
    expect(await connectedApp("https://claude.ai/oauth/mcp-oauth-client-metadata")).toEqual({ name: "Claude", verified: true });
    await pg.query(`insert into oauth_client (id, client_id, name, redirect_uris) values ('dcr-real', 'dcr-real', 'ChatGPT', '{https://chatgpt.com/connector_platform_oauth_redirect}')`);
    const app = await connectedApp("dcr-real");
    expect(app).toEqual({ name: "ChatGPT", verified: true });
    expect(approverLine(approverFor(app))).toBe("Last approved through Queue Pilot: by ChatGPT");
  });

  it("caps a long self-declared name", async () => {
    await pg.query(`insert into oauth_client (id, client_id, name, redirect_uris) values ('dcr-long', 'dcr-long', $1, '{https://attacker.example/cb}')`, ["x".repeat(500)]);
    const app = await connectedApp("dcr-long");
    expect(app.verified).toBe(false);
    expect(Array.from(app.name)).toHaveLength(60);
    expect(app.name.endsWith("…")).toBe(true);
  });
});

describe("removing a connected app on real Postgres", () => {
  const removedLine = async (user: string) => {
    const removed = (await recentSecurityEvents(user, 50)).find((e) => e.event === "app_revoked");
    expect(removed).toBeDefined();
    return showSecurityEvent(removed!).what;
  };

  it("keeps a self-named client unverified after its approval is removed", async () => {
    await pg.query(`insert into "user" (id, name, email) values ('r1', 'r1', 'r1@x')`);
    await pg.query(`insert into oauth_client (id, client_id, name, redirect_uris) values ('rm-evil', 'rm-evil', 'Claude', '{https://attacker.example/cb}')`);
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values ('rm-k1', 'rm-evil', 'r1', '{openid}', now(), now())`);
    expect(await revokeApp("r1", "rm-k1")).toBe(true);
    expect(await removedLine("r1")).toBe('Removed an unverified app named "Claude"');
  });

  it("names a client its registered address proves by its brand", async () => {
    await pg.query(`insert into "user" (id, name, email) values ('r2', 'r2', 'r2@x')`);
    await pg.query(`insert into oauth_client (id, client_id, name, redirect_uris) values ('rm-real', 'rm-real', 'ChatGPT', '{https://chatgpt.com/connector_platform_oauth_redirect}')`);
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values ('rm-k2', 'rm-real', 'r2', '{openid}', now(), now())`);
    expect(await revokeApp("r2", "rm-k2")).toBe(true);
    expect(await removedLine("r2")).toBe("Removed ChatGPT");
  });

  it("caps a long self-declared name when removing it", async () => {
    await pg.query(`insert into "user" (id, name, email) values ('r3', 'r3', 'r3@x')`);
    await pg.query(`insert into oauth_client (id, client_id, name, redirect_uris) values ('rm-long', 'rm-long', $1, '{https://attacker.example/cb}')`, ["y".repeat(500)]);
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values ('rm-k3', 'rm-long', 'r3', '{openid}', now(), now())`);
    await revokeApp("r3", "rm-k3");
    const removed = (await recentSecurityEvents("r3", 5)).find((e) => e.event === "app_revoked");
    expect(removed?.detail).toMatchObject({ verified: "false" });
    expect(Array.from(removed!.detail!.app)).toHaveLength(60);
  });

  it("refuses another person's approval and records nothing", async () => {
    await pg.query(`insert into oauth_consent (id, client_id, user_id, scopes, created_at, updated_at) values ('rm-k4', 'rm-evil', 'a', '{openid}', now(), now())`);
    expect(await revokeApp("r1", "rm-k4")).toBe(false);
    expect((await recentSecurityEvents("a", 50)).some((e) => e.event === "app_revoked")).toBe(false);
  });

  it("keeps each draft's account and slot, and leaves unknown drafts out", async () => {
    const { draftSlot } = await import("./security-events");
    const channels = [{ id: "c1", name: "Alex | Rivera", service: "linkedin" }];
    const slot = draftSlot({ channelId: "c1", dueAt: "2026-11-17T17:00:00.000Z" }, channels);
    expect(slot).toBe("LinkedIn|Alex   Rivera|2026-11-17T17:00:00.000Z");
    await recordAction("b", "draft_deleted", { via: "app" }, { ids: ["d1"], slots: [slot, draftSlot(undefined, channels)] });
    const [latest] = await recentSecurityEvents("b", 1);
    expect(latest.detail?.slots).toBe("LinkedIn|Alex   Rivera|2026-11-17T17:00:00.000Z");
  });
});
