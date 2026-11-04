/**
 * @fileoverview What `/` serves: the landing page with no session cookie, the app with one.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "./proxy";

const home = (cookie?: string) => new NextRequest("https://getqueuepilot.com/", { headers: cookie ? { cookie } : {} });

describe("home routing", () => {
  it("serves the landing page at / to a visitor with no session", () => {
    const res = proxy(home());
    expect(new URL(res.headers.get("x-middleware-rewrite") ?? "").pathname).toBe("/welcome");
  });

  it("passes a visitor with a session cookie through to the app", () => {
    const res = proxy(home("better-auth.session_token=abc.def"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("treats the secure cookie name used over HTTPS as a session too", () => {
    const res = proxy(home("__Secure-better-auth.session_token=abc.def"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("ignores unrelated cookies", () => {
    const res = proxy(home("theme=dark; other=1"));
    expect(new URL(res.headers.get("x-middleware-rewrite") ?? "").pathname).toBe("/welcome");
  });
});
