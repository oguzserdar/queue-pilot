/**
 * @fileoverview The one client-IP resolver: the configured hop of X-Forwarded-For, or the shared untrusted key, never
 * x-real-ip; and Better Auth's limiter keyed by that same answer through the private header.
 */
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { describe, expect, it } from "vitest";
import { BETTER_AUTH_IP_ADDRESS, CLIENT_IP_HEADER, UNTRUSTED_CLIENT_IP, clientIp, trustedProxyHopCount, withClientIp } from "./client-ip";

const h = (xff?: string, extra: Record<string, string> = {}) => new Headers({ ...(xff !== undefined ? { "x-forwarded-for": xff } : {}), ...extra });
const hops = (n: string | undefined) => ({ TRUSTED_PROXY_HOP_COUNT: n });

describe("trustedProxyHopCount", () => {
  it("is 1 when unset, the shape of Vercel and one reverse proxy", () => {
    expect(trustedProxyHopCount({})).toBe(1);
  });
  it("reads 0 to 10", () => {
    expect(trustedProxyHopCount(hops("0"))).toBe(0);
    expect(trustedProxyHopCount(hops("3"))).toBe(3);
    expect(trustedProxyHopCount(hops("10"))).toBe(10);
  });
  it("trusts nothing when the value is not a whole number from 0 to 10, so a typo never widens trust", () => {
    for (const v of ["-1", "11", "1.5", "two", " "]) expect(trustedProxyHopCount(hops(v))).toBe(0);
  });
});

describe("clientIp", () => {
  it("with hop count 0, a forged X-Forwarded-For cannot choose a bucket", () => {
    expect(clientIp(h("203.0.113.7"), hops("0"))).toBe(UNTRUSTED_CLIENT_IP);
    expect(clientIp(h("198.51.100.9"), hops("0"))).toBe(UNTRUSTED_CLIENT_IP);
  });
  it("with hop count 1, takes the rightmost entry, so a client-written first entry is ignored", () => {
    expect(clientIp(h("203.0.113.7"), hops("1"))).toBe("203.0.113.7");
    expect(clientIp(h("6.6.6.6, 203.0.113.7"), hops("1"))).toBe("203.0.113.7");
  });
  it("with hop count 2, takes the second entry from the right", () => {
    expect(clientIp(h("6.6.6.6, 203.0.113.7, 10.0.0.2"), hops("2"))).toBe("203.0.113.7");
  });
  it("answers the shared untrusted key when the chain is shorter than the hop count", () => {
    expect(clientIp(h("203.0.113.7"), hops("2"))).toBe(UNTRUSTED_CLIENT_IP);
  });
  it("answers the shared untrusted key when the selected hop is not an address", () => {
    for (const v of ["not-an-ip", "203.0.113.7:443", "", "6.6.6.6, ", "999.1.1.1"]) expect(clientIp(h(v), hops("1"))).toBe(UNTRUSTED_CLIENT_IP);
  });
  it("ignores x-real-ip, with or without X-Forwarded-For", () => {
    expect(clientIp(h(undefined, { "x-real-ip": "203.0.113.7" }), hops("1"))).toBe(UNTRUSTED_CLIENT_IP);
    expect(clientIp(h("6.6.6.6, not-an-ip", { "x-real-ip": "203.0.113.7" }), hops("1"))).toBe(UNTRUSTED_CLIENT_IP);
  });
  it("never reads its own private header from the request", () => {
    expect(clientIp(h(undefined, { [CLIENT_IP_HEADER]: "203.0.113.7" }), hops("1"))).toBe(UNTRUSTED_CLIENT_IP);
  });
  it("counts an IPv6 address by its /64, the way Better Auth does, so rotating within one network is one bucket", () => {
    expect(clientIp(h("2001:db8:1:2::a"), hops("1"))).toBe(clientIp(h("2001:db8:1:2:ffff::b"), hops("1")));
    expect(clientIp(h("2001:db8:1:2::a"), hops("1"))).not.toBe(clientIp(h("2001:db8:1:3::a"), hops("1")));
  });
  it("reads an IPv4-mapped IPv6 address as its IPv4 address", () => {
    expect(clientIp(h("::ffff:203.0.113.7"), hops("1"))).toBe("203.0.113.7");
  });
  it("with TRUSTED_PROXIES set, walks from the right past those proxies and their ranges", () => {
    expect(clientIp(h("6.6.6.6, 203.0.113.7, 10.0.0.2"), { TRUSTED_PROXIES: "10.0.0.2" })).toBe("203.0.113.7");
    expect(clientIp(h("6.6.6.6, 203.0.113.7, 10.1.2.3, 10.0.0.2"), { TRUSTED_PROXIES: "10.0.0.0/8" })).toBe("203.0.113.7");
  });
  it("with TRUSTED_PROXIES set, answers the untrusted key when every entry is a proxy or the client entry is malformed", () => {
    expect(clientIp(h("10.0.0.3, 10.0.0.2"), { TRUSTED_PROXIES: "10.0.0.0/8" })).toBe(UNTRUSTED_CLIENT_IP);
    expect(clientIp(h("junk, 10.0.0.2"), { TRUSTED_PROXIES: "10.0.0.2" })).toBe(UNTRUSTED_CLIENT_IP);
  });
});

describe("withClientIp", () => {
  it("overwrites a client-sent private header with the resolved address", () => {
    const req = new Request("https://qp.example/api/auth/ok", { headers: { "x-forwarded-for": "203.0.113.7", [CLIENT_IP_HEADER]: "198.51.100.1" } });
    expect(withClientIp(req, hops("1")).headers.get(CLIENT_IP_HEADER)).toBe("203.0.113.7");
    expect(withClientIp(req, hops("0")).headers.get(CLIENT_IP_HEADER)).toBe(UNTRUSTED_CLIENT_IP);
  });
  it("keeps the method, address and body", async () => {
    const req = new Request("https://qp.example/api/auth/x", { method: "POST", body: "a=1", headers: { "x-forwarded-for": "203.0.113.7" } });
    const out = withClientIp(req, hops("1"));
    expect(out.method).toBe("POST");
    expect(out.url).toBe(req.url);
    expect(await out.text()).toBe("a=1");
  });
});

describe("Better Auth's limiter", () => {
  const auth = betterAuth({
    secret: "test-secret-test-secret-test-secret-1234",
    baseURL: "https://qp.example",
    database: memoryAdapter(new Proxy({} as Record<string, unknown[]>, { get: (t, k: string) => (t[k] ??= []) })),
    advanced: { ipAddress: BETTER_AUTH_IP_ADDRESS },
    rateLimit: { enabled: true, storage: "memory", customRules: { "/ok": { window: 60, max: 1 } } },
  });
  const call = (xff: string, forged?: string) =>
    auth.handler(withClientIp(new Request("https://qp.example/api/auth/ok", { headers: { "x-forwarded-for": xff, ...(forged ? { [CLIENT_IP_HEADER]: forged } : {}) } }), hops("1")));

  it("counts by the same resolved address, so a forged first entry or private header does not change the bucket", async () => {
    expect((await call("203.0.113.7")).status).toBe(200);
    expect((await call("6.6.6.6, 203.0.113.7", "198.51.100.1")).status).toBe(429);
    expect((await call("203.0.113.8", "203.0.113.7")).status).toBe(200);
  });
});
