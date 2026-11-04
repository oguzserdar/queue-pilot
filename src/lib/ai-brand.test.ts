import { describe, expect, it } from "vitest";
import { aiBrand } from "./ai-brand";

describe("AI display marks", () => {
  it("recognizes exact registered names and metadata hosts without conflating Cursor and Grok", () => {
    expect(aiBrand("Cursor")).toBe("Cursor");
    expect(aiBrand("Grok")).toBe("Grok");
    expect(aiBrand("grok.com")).toBe("Grok");
    expect(aiBrand(" Codex ")).toBe("Codex");
    expect(aiBrand("Claude Code")).toBe("Claude Code");
  });
  it("does not brand lookalike hosts, partial names or opaque ids", () => {
    for (const name of ["grok.com.evil.test", "Not Cursor", "fake-Claude", "uMuNprIVRtoVFlCEPfNsnXjSNWKQxMDB"]) expect(aiBrand(name)).toBeNull();
  });
});
