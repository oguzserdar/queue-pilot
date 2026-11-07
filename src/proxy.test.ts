/**
 * @fileoverview Who sees what: the homepage at `/` for a visitor with no session, the demo only after "Try the demo",
 * and the app's screens only after signing in with Buffer.
 */
import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { APP_SCREENS, DEMO_COOKIE, config, proxy } from "./proxy";

const SESSION = "better-auth.session_token=abc.def";
const DEMO = `${DEMO_COOKIE}=1`;
const at = (path: string, ...cookies: string[]) => new NextRequest(`https://getqueuepilot.com${path}`, { headers: cookies.length ? { cookie: cookies.join("; ") } : {} });
const rewrittenTo = (res: Response) => { const r = res.headers.get("x-middleware-rewrite"); return r ? new URL(r).pathname : null; };
const redirectedTo = (res: Response) => { const l = res.headers.get("location"); return l ? new URL(l).pathname : null; };
const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("the homepage", () => {
  it("shows the homepage at / to a visitor with no session, keeping the address /", () => {
    expect(rewrittenTo(proxy(at("/")))).toBe("/home");
  });
  it("sends anyone who types the homepage's own address to /", () => {
    expect(redirectedTo(proxy(at("/home")))).toBe("/");
  });
  it("ignores unrelated cookies", () => {
    expect(rewrittenTo(proxy(at("/", "theme=dark")))).toBe("/home");
  });
});

describe("the app's screens", () => {
  it("are only for someone signed in with Buffer", () => {
    for (const path of ["/week", "/playbook", "/settings", "/sources/new", "/connect"]) expect(redirectedTo(proxy(at(path))), path).toBe("/");
  });
  it("open for a session, including the secure cookie name used over HTTPS", () => {
    expect(passes(proxy(at("/week", SESSION)))).toBe(true);
    expect(passes(proxy(at("/", "__Secure-better-auth.session_token=abc.def")))).toBe(true);
  });
});

describe("the demo", () => {
  it("starts from /demo and opens the app's home with sample data", () => {
    const res = proxy(at("/demo"));
    expect(redirectedTo(res)).toBe("/");
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${DEMO_COOKIE}=1`));
  });
  it("lets a demo visitor use every screen", () => {
    expect(passes(proxy(at("/", DEMO)))).toBe(true);
    expect(passes(proxy(at("/week", DEMO)))).toBe(true);
  });
  it("ends at /demo/leave, back on the homepage", () => {
    const res = proxy(at("/demo/leave", DEMO));
    expect(redirectedTo(res)).toBe("/");
    expect(res.headers.get("set-cookie")).toMatch(new RegExp(`${DEMO_COOKIE}=;`));
  });
  it("sends someone signed in to their own app instead, so the demo never acts on a real account", () => {
    const res = proxy(at("/demo", SESSION));
    expect(redirectedTo(res)).toBe("/");
    expect(res.headers.get("set-cookie") ?? "").not.toMatch(new RegExp(`${DEMO_COOKIE}=1`));
  });
});

it("runs on every app screen and its subpages", () => {
  for (const p of APP_SCREENS) expect(config.matcher, p).toContain(`${p}/:path*`);
});
