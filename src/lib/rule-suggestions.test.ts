import { afterEach, describe, expect, it, vi } from "vitest";
import { signSuggestion, verifySuggestion } from "./rule-suggestions";
vi.mock("server-only", () => ({}));
afterEach(() => vi.unstubAllEnvs());
describe("signed rule suggestions", () => {
  it("rejects another person, changed contents and an expired proposal", () => {
    vi.stubEnv("SESSION_SECRET", "test-key");
    const suggestion = { key: "fix", rule: { kind: "guidance" as const, text: "Plain words", channels: "all" as const, level: "warn" as const }, fixes: 2, evidence: [] };
    const token = signSuggestion("a", suggestion, 1000);
    expect(verifySuggestion("a", token, 1001)).toEqual(suggestion);
    expect(verifySuggestion("b", token, 1001)).toBeNull();
    expect(verifySuggestion("a", token, 3601000)).toBeNull();
    const [body, signature] = token.split(".");
    const changed = JSON.parse(Buffer.from(body, "base64url").toString());
    changed.suggestion.rule.text = "Malicious replacement";
    expect(verifySuggestion("a", `${Buffer.from(JSON.stringify(changed)).toString("base64url")}.${signature}`, 1001)).toBeNull();
    expect(verifySuggestion("a", token + ".extra", 1001)).toBeNull();
  });
});
