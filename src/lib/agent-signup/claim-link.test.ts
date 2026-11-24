import { beforeEach, describe, expect, it, vi } from "vitest";

// Wrap timingSafeEqual so the tests can prove every secret comparison goes through it. A spy on the ESM named export
// would not see calls made through the module's own binding, so the module itself is replaced with a pass-through.
vi.mock("node:crypto", async (importOriginal) => {
  const real = await importOriginal<typeof import("node:crypto")>();
  return { ...real, timingSafeEqual: vi.fn<typeof real.timingSafeEqual>(real.timingSafeEqual) };
});

const crypto = await import("node:crypto");
const {
  CLAIM_CODE_ALPHABET,
  LINK_SECRET_FALLBACK_DAYS,
  MAX_CODE_ATTEMPTS,
  checkClaimCode,
  claimToken,
  claimUrl,
  codeAttempt,
  generateClaimCode,
  hashClaimCode,
  normalizeClaimCode,
  parseClaimToken,
  verifyClaimToken,
} = await import("./claim-link");

const safeEqual = vi.mocked(crypto.timingSafeEqual);
// A block body: mockClear returns the mock, and a function returned from beforeEach is run as a teardown.
beforeEach(() => {
  safeEqual.mockClear();
});

const oldKey = { id: "k1", key: "o".repeat(40) };
const newKey = { id: "k2", key: "n".repeat(40) };
const ticket = { route: "link" as const, ticketId: "tkt_abc", registrationId: "reg_123" };
const now = new Date("2026-11-14T12:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 60 * 60 * 1000);

describe("the claim link", () => {
  it("has the contract's shape: ct_{ticket id}.{key id}.{mac}, under /claim/", () => {
    const token = claimToken({ current: newKey }, ticket);
    expect(token).toMatch(/^ct_tkt_abc\.k2\.[A-Za-z0-9_-]{43}$/);
    expect(claimUrl("https://qp.example/some/path", { current: newKey }, ticket)).toBe(`https://qp.example/claim/${token}`);
    expect(parseClaimToken(token)).toEqual({ ticketId: "tkt_abc", keyId: "k2", mac: token.split(".")[2] });
  });

  it("is rebuilt, not stored: the same inputs always give the same link", () => {
    expect(claimToken({ current: newKey }, ticket)).toBe(claimToken({ current: newKey }, ticket));
  });

  it("verifies with the current secret", () => {
    const token = claimToken({ current: newKey }, ticket);
    expect(verifyClaimToken({ current: newKey }, token, ticket, now)).toBe(true);
  });

  it("still verifies a link made with the previous secret, inside the fallback window", () => {
    const token = claimToken({ current: oldKey }, ticket);
    const rotated = { current: newKey, previous: { ...oldKey, retiredAt: daysAgo(LINK_SECRET_FALLBACK_DAYS - 1) } };
    expect(verifyClaimToken(rotated, token, ticket, now)).toBe(true);
  });

  it("refuses a link from the previous secret once the fallback window has passed", () => {
    expect(LINK_SECRET_FALLBACK_DAYS).toBe(34);
    const token = claimToken({ current: oldKey }, ticket);
    const rotated = { current: newKey, previous: { ...oldKey, retiredAt: daysAgo(LINK_SECRET_FALLBACK_DAYS) } };
    expect(verifyClaimToken(rotated, token, ticket, now)).toBe(false);
  });

  it("fails with neither secret", () => {
    const stranger = { id: "k9", key: "s".repeat(40) };
    const token = claimToken({ current: stranger }, ticket);
    expect(verifyClaimToken({ current: newKey, previous: { ...oldKey, retiredAt: daysAgo(1) } }, token, ticket, now)).toBe(false);
    // Same key id as ours, different key: the mac decides, not the id.
    const spoofed = claimToken({ current: { id: "k2", key: "s".repeat(40) } }, ticket);
    expect(verifyClaimToken({ current: newKey }, spoofed, ticket, now)).toBe(false);
  });

  it("binds the route, the ticket and the registration", () => {
    const token = claimToken({ current: newKey }, ticket);
    const keys = { current: newKey };
    expect(verifyClaimToken(keys, token, { ...ticket, registrationId: "reg_other" }, now)).toBe(false);
    expect(verifyClaimToken(keys, token, { ...ticket, route: "email" }, now)).toBe(false);
    expect(verifyClaimToken(keys, token, { ...ticket, ticketId: "tkt_other" }, now)).toBe(false);
  });

  it("compares the mac in constant time", () => {
    const token = claimToken({ current: newKey }, ticket);
    verifyClaimToken({ current: newKey }, token, ticket, now);
    expect(safeEqual).toHaveBeenCalled();
  });

  it("returns false for malformed tokens instead of throwing", () => {
    for (const bad of ["", "ct_", "ct_tkt_abc", "ct_tkt_abc.k2", "ct_tkt_abc.k2.short", "xx_tkt_abc.k2.AAAA", "ct_a.b.c.d"]) {
      expect(verifyClaimToken({ current: newKey }, bad, ticket, now)).toBe(false);
    }
  });

  it("refuses ids and keys that would make the token ambiguous or weak", () => {
    expect(() => claimToken({ current: newKey }, { ...ticket, ticketId: "tkt.a" })).toThrow("Ticket ids are 1 to 64 characters");
    expect(() => claimToken({ current: newKey }, { ...ticket, registrationId: "reg\nx" })).toThrow("Not a registration id");
    expect(() => claimToken({ current: { id: "k1", key: "short" } }, ticket)).toThrow("Claim-link secrets must be at least");
    expect(() => claimToken({ current: newKey }, { ...ticket, route: "computer" as "link" })).toThrow("Only the link and email routes have claim links");
  });
});

describe("the claim code for the computer route", () => {
  const codeKey = "c".repeat(40);

  it("is 8 characters from a 31-character alphabet with no 0, 1, I, L or O, shown as XXXX-XXXX", () => {
    expect(CLAIM_CODE_ALPHABET).toHaveLength(31);
    expect(CLAIM_CODE_ALPHABET).not.toMatch(/[01ILO]/);
    for (let i = 0; i < 50; i++) expect(generateClaimCode()).toMatch(/^[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/);
  });

  it("accepts what a person types: lower case, spaces, or no hyphen", () => {
    expect(normalizeClaimCode(" wdjb-mjht ")).toBe("WDJBMJHT");
    expect(normalizeClaimCode("WDJB MJHT")).toBe("WDJBMJHT");
    expect(normalizeClaimCode("WDJB-MJH")).toBeNull();
    expect(normalizeClaimCode("WDJB-MJH0")).toBeNull();
  });

  it("is stored only as a keyed hash, never as itself", () => {
    const code = generateClaimCode();
    const stored = hashClaimCode(code, codeKey);
    expect(stored).toMatch(/^[0-9a-f]{64}$/);
    expect(stored).not.toContain(normalizeClaimCode(code));
    // Keyed: a copy of the database alone cannot test guesses against it.
    expect(hashClaimCode(code, "d".repeat(40))).not.toBe(stored);
  });

  it("checks a typed code against the stored hash in constant time", () => {
    const stored = hashClaimCode("WDJB-MJHT", codeKey);
    expect(checkClaimCode("wdjb mjht", stored, codeKey)).toBe(true);
    expect(safeEqual).toHaveBeenCalled();
    expect(checkClaimCode("WDJB-MJHX", stored, codeKey)).toBe(false);
    expect(checkClaimCode("not a code", stored, codeKey)).toBe(false);
  });
});

describe("wrong-code attempts", () => {
  it("allows five tries: the right code on the fifth try still works", () => {
    let attempts = 0;
    for (let i = 0; i < MAX_CODE_ATTEMPTS - 1; i++) {
      const r = codeAttempt(attempts, false);
      expect(r.outcome).toBe("wrong");
      attempts = r.attempts;
    }
    expect(attempts).toBe(4);
    expect(codeAttempt(attempts, true)).toEqual({ outcome: "accepted", attempts: 4 });
  });

  it("kills the ticket on the fifth wrong try", () => {
    expect(MAX_CODE_ATTEMPTS).toBe(5);
    expect(codeAttempt(4, false)).toEqual({ outcome: "locked", attempts: 5 });
  });

  it("refuses even the right code once the ticket is dead", () => {
    expect(codeAttempt(5, true)).toEqual({ outcome: "locked", attempts: 5 });
    expect(codeAttempt(9, false)).toEqual({ outcome: "locked", attempts: 9 });
  });
});
