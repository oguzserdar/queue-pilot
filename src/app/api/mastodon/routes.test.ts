/**
 * @fileoverview The Mastodon connect routes: a signed-out person is sent back to Settings, the start sets the sealed
 * cookie only for the callback path and sends the person to the instance, and the callback clears the cookie and
 * reports the outcome without ever putting a token in the address.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const user = vi.hoisted(() => ({ id: null as string | null }));
const connect = vi.hoisted(() => ({ start: vi.fn<typeof import("@/lib/social-connect").startMastodonConnect>(), finish: vi.fn<typeof import("@/lib/social-connect").finishMastodonConnect>() }));
vi.mock("@/lib/current-user", () => ({ signedInUserId: async () => user.id }));
vi.mock("@/lib/rate-limit", () => ({ limit: async () => ({ ok: true }) }));
vi.mock("@/lib/social-connect", async () => {
  class ConnectError extends Error { constructor(m: string, readonly code: string) { super(m); } }
  return { MASTODON_COOKIE: "qp_mastodon", MASTODON_COOKIE_MAX_AGE_S: 600, ConnectError, startMastodonConnect: connect.start, finishMastodonConnect: connect.finish };
});
vi.stubEnv("SETTINGS_KEY", "11".repeat(32));
const { POST: start } = await import("./start/route");
const { GET: callback } = await import("./callback/route");

const form = (instance: string) => new NextRequest("https://qp.example/api/mastodon/start", { method: "POST", body: new URLSearchParams({ instance }), headers: { "content-type": "application/x-www-form-urlencoded", host: "qp.example", "x-forwarded-proto": "https" } });

beforeEach(() => { user.id = "u1"; connect.start.mockReset(); connect.finish.mockReset(); });

describe("POST /api/mastodon/start", () => {
  it("sends a signed-out person back to Settings and starts nothing", async () => {
    user.id = null;
    const res = await start(form("mastodon.social"));
    expect(res.headers.get("location")).toMatch(/\/settings\?mastodon=signed-out$/);
    expect(connect.start).not.toHaveBeenCalled();
  });

  it("sends the person to the instance with a cookie scoped to the callback", async () => {
    connect.start.mockResolvedValue({ url: "https://m.example/oauth/authorize?state=s", cookie: "sealed" });
    const res = await start(form("m.example"));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://m.example/oauth/authorize?state=s");
    expect(connect.start.mock.calls[0].slice(0, 3)).toEqual(["u1", "m.example", "https://qp.example/api/mastodon/callback"]);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toMatch(/qp_mastodon=sealed/);
    expect(cookie).toMatch(/Path=\/api\/mastodon/);
    expect(cookie).toMatch(/HttpOnly/i);
  });

  it("reports a refused address with its code", async () => {
    const { ConnectError } = await import("@/lib/social-connect");
    connect.start.mockRejectedValue(new ConnectError("no", "bad-address"));
    const res = await start(form("localhost"));
    expect(res.headers.get("location")).toMatch(/\/settings\?mastodon=bad-address$/);
  });
});

describe("GET /api/mastodon/callback", () => {
  const cb = (q: string) => new NextRequest(`https://qp.example/api/mastodon/callback?${q}`, { headers: { host: "qp.example", "x-forwarded-proto": "https", cookie: "qp_mastodon=sealed" } });

  it("passes the cookie, state and code through, clears the cookie and reports connected", async () => {
    connect.finish.mockResolvedValue({ handle: "@ada@m.example" });
    const res = await callback(cb("state=s&code=c"));
    expect(connect.finish.mock.calls[0][0]).toMatchObject({ userId: "u1", cookie: "sealed", state: "s", code: "c", redirectUri: "https://qp.example/api/mastodon/callback" });
    expect(res.headers.get("location")).toMatch(/\/settings\?mastodon=connected$/);
    expect(res.headers.get("set-cookie")).toMatch(/qp_mastodon=;/);
  });

  it("reports a mismatched sign-in as expired", async () => {
    const { ConnectError } = await import("@/lib/social-connect");
    connect.finish.mockRejectedValue(new ConnectError("no", "expired"));
    const res = await callback(cb("state=x&code=c"));
    expect(res.headers.get("location")).toMatch(/\/settings\?mastodon=expired$/);
  });
});
