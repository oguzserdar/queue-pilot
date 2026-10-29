import { describe, expect, it, vi } from "vitest";
import { BufferApiError, BufferRateLimitedError, bufferQuery, parseRateLimit } from "./client";

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

describe("bufferQuery", () => {
  it("sends the bearer token and returns data", async () => {
    const fetchImpl = vi.fn(async () => json({ data: { account: { id: "a1" } } }));
    const data = await bufferQuery<{ account: { id: string } }>("tok", "{ account { id } }", undefined, { fetchImpl });
    expect(data.account.id).toBe("a1");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("raises Buffer's own GraphQL error message", async () => {
    const fetchImpl = vi.fn(async () => json({ errors: [{ message: "Channel is disconnected" }] }));
    await expect(bufferQuery("t", "{x}", undefined, { fetchImpl })).rejects.toThrow("Channel is disconnected");
  });

  it("waits Retry-After once on 429, then succeeds", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(json({}, 429, { "retry-after": "2" }))
      .mockResolvedValueOnce(json({ data: { ok: true } }));
    await expect(bufferQuery("t", "{x}", undefined, { fetchImpl, sleep })).resolves.toEqual({ ok: true });
    expect(sleep).toHaveBeenCalledWith(2000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("gives up after one wait instead of looping", async () => {
    const fetchImpl = vi.fn(async () => json({}, 429, { "retry-after": "1" }));
    await expect(bufferQuery("t", "{x}", undefined, { fetchImpl, sleep: async () => {} })).rejects.toBeInstanceOf(BufferApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports an expired or revoked sign-in as 401", async () => {
    const fetchImpl = vi.fn(async () => json({}, 401));
    await expect(bufferQuery("t", "{x}", undefined, { fetchImpl })).rejects.toMatchObject({ status: 401 });
  });

  it("fails at once with the reset time when the wait is long (the daily window)", async () => {
    const sleep = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => json({}, 429, { "retry-after": "7200" }));
    const err = await bufferQuery("t", "{x}", undefined, { fetchImpl, sleep, now: () => 0 }).catch((e) => e);
    expect(err).toBeInstanceOf(BufferRateLimitedError);
    expect((err as BufferRateLimitedError).retryAt.getTime()).toBe(7_200_000);
    expect(sleep).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reads Retry-After in HTTP-date form (RFC 9110) instead of crashing", async () => {
    const now = Date.parse("2026-10-28T12:00:00Z");
    const fetchImpl = vi.fn(async () => json({}, 429, { "retry-after": "Wed, 28 Oct 2026 14:00:00 GMT" }));
    const err = await bufferQuery("t", "{x}", undefined, { fetchImpl, sleep: async () => {}, now: () => now }).catch((e) => e);
    expect(err).toBeInstanceOf(BufferRateLimitedError);
    expect((err as BufferRateLimitedError).retryAt.toISOString()).toBe("2026-10-28T14:00:00.000Z");
  });

  it("waits 60 seconds when Retry-After is missing or unreadable", async () => {
    for (const header of [undefined, "soon"]) {
      const fetchImpl = vi.fn(async () => json({}, 429, header ? { "retry-after": header } : {}));
      const err = await bufferQuery("t", "{x}", undefined, { fetchImpl, now: () => 0 }).catch((e) => e);
      expect((err as BufferRateLimitedError).retryAt.getTime()).toBe(60_000);
    }
  });

  it("keeps Buffer's own error message on a failed HTTP response", async () => {
    const fetchImpl = vi.fn(async () => json({ errors: [{ message: "Organization not found" }] }, 400));
    await expect(bufferQuery("t", "{x}", undefined, { fetchImpl })).rejects.toThrow("Buffer API returned 400: Organization not found");
  });

  it("reports Buffer's windows after every response", async () => {
    const onRateLimit = vi.fn();
    const header = '"100-in-15min";r=98;t=897, "250-in-24h";r=12;t=40000';
    const fetchImpl = vi.fn(async () => json({ data: { ok: true } }, 200, { ratelimit: header }));
    await bufferQuery("t", "{x}", undefined, { fetchImpl, onRateLimit });
    expect(onRateLimit).toHaveBeenCalledWith([
      { policy: "100-in-15min", remaining: 98, resetSeconds: 897 },
      { policy: "250-in-24h", remaining: 12, resetSeconds: 40000 },
    ]);
  });
});

describe("parseRateLimit", () => {
  it("reads the documented example and skips malformed entries", () => {
    expect(parseRateLimit('"100-in-15min";r=98;t=897')).toEqual([{ policy: "100-in-15min", remaining: 98, resetSeconds: 897 }]);
    expect(parseRateLimit('"broken";r=x, "250-in-24h";r=0;t=5')).toEqual([{ policy: "250-in-24h", remaining: 0, resetSeconds: 5 }]);
    expect(parseRateLimit(null)).toEqual([]);
  });
});
