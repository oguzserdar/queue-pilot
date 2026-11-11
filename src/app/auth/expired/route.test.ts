/**
 * @fileoverview A sign-in cookie whose session no longer exists (account deleted, session expired, signed out on
 * another device) is cleared here, and the visitor lands on the homepage. A live session is never touched, so a link
 * to this address cannot sign anyone out.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getSession = vi.fn();
vi.mock("@/lib/auth", () => ({ getAuth: async () => ({ api: { getSession } }) }));

const { GET } = await import("./route");
const req = () => new NextRequest("https://getqueuepilot.com/auth/expired", {
  headers: { cookie: "__Secure-better-auth.session_token=dead; better-auth.session_data.0=x; theme=dark" },
});

beforeEach(() => getSession.mockReset());

describe("GET /auth/expired", () => {
  it("clears every sign-in cookie of a session that no longer exists and sends the visitor home", async () => {
    getSession.mockResolvedValue(null);
    const res = await GET(req());
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    const cleared = res.headers.getSetCookie();
    expect(cleared).toHaveLength(2);
    expect(cleared[0]).toMatch(/^__Secure-better-auth\.session_token=;.*Max-Age=0.*Secure/i);
    expect(cleared[1]).toMatch(/^better-auth\.session_data\.0=;.*Max-Age=0/i);
    expect(cleared.join()).not.toMatch(/theme=/);
  });

  it("leaves a live session alone and just goes home", async () => {
    getSession.mockResolvedValue({ user: { id: "person-a" }, session: { id: "s" } });
    const res = await GET(req());
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.getSetCookie()).toEqual([]);
  });
});
