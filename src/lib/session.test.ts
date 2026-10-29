import { describe, expect, it } from "vitest";
import { openSession, sealSession } from "./session";

const SECRET = "x".repeat(32);

describe("session cookie", () => {
  it("round-trips the Buffer account id", () => {
    expect(openSession(sealSession("acct_1", SECRET), SECRET)).toBe("acct_1");
  });
  it("rejects a cookie whose account id was changed", () => {
    const sealed = sealSession("acct_1", SECRET);
    expect(openSession(sealed.replace("acct_1", "acct_2"), SECRET)).toBeNull();
  });
  it("rejects a cookie signed with another secret", () => {
    expect(openSession(sealSession("acct_1", "y".repeat(32)), SECRET)).toBeNull();
  });
  it("rejects empty or malformed cookies", () => {
    expect(openSession(undefined, SECRET)).toBeNull();
    expect(openSession("no-dot", SECRET)).toBeNull();
  });
});
