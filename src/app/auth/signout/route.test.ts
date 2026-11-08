/**
 * @fileoverview Sign-out answers with a same-site relative redirect, so a proxy's internal host is never the target
 * (form-action 'self' would block it), and keeps every cookie-clearing header Better Auth sends.
 */
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const signOut = vi.fn();
vi.mock("@/lib/auth", () => ({ getAuth: async () => ({ api: { signOut } }) }));

const { POST } = await import("./route");

describe("POST /auth/signout", () => {
  it("redirects to a relative / behind a proxy whose internal host differs, keeping each clearing cookie", async () => {
    const out = new Headers();
    out.append("set-cookie", "qp.session_token=; Max-Age=0; Path=/");
    out.append("set-cookie", "qp.session_data=; Max-Age=0; Path=/");
    signOut.mockResolvedValue(new Response(null, { headers: out }));
    const req = new NextRequest("http://localhost:43781/auth/signout", {
      method: "POST",
      headers: { origin: "https://qp.example.org", "x-forwarded-host": "qp.example.org" },
    });
    const res = await POST(req);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.getSetCookie()).toEqual(["qp.session_token=; Max-Age=0; Path=/", "qp.session_data=; Max-Age=0; Path=/"]);
  });
});
