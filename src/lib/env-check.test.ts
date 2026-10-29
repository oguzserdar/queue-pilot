import { describe, expect, it } from "vitest";
import { envProblems } from "./env-check.mjs";

const good = { DATABASE_URL: "postgres://x", SESSION_SECRET: "s".repeat(32), SETTINGS_KEY: "a".repeat(64) };

describe("envProblems", () => {
  it("passes a complete setup", () => {
    expect(envProblems(good)).toEqual([]);
  });
  it("names each problem and how to fix it", () => {
    const p = envProblems({ ...good, SETTINGS_KEY: "short" });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatch(/SETTINGS_KEY.*openssl rand -hex 32/);
  });
});
