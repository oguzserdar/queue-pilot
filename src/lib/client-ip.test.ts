import { describe, expect, it } from "vitest";
import { clientIp } from "./client-ip";

const h = (xff: string, real?: string) => new Headers({ "x-forwarded-for": xff, ...(real ? { "x-real-ip": real } : {}) });

describe("clientIp", () => {
  it("uses the single address Vercel sets", () => {
    expect(clientIp(h("203.0.113.7"), [])).toBe("203.0.113.7");
  });
  it("walks a proxy chain from the right past trusted proxies, so a spoofed first entry is ignored", () => {
    expect(clientIp(h("6.6.6.6, 203.0.113.7, 10.0.0.2"), ["10.0.0.2"])).toBe("203.0.113.7");
  });
  it("takes the last hop when no proxy is trusted, never the client-written first entry", () => {
    expect(clientIp(h("6.6.6.6, 203.0.113.7"), [])).toBe("203.0.113.7");
  });
});
