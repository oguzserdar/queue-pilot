import { describe, expect, it } from "vitest";
import { approvedClientBrand, consentIdentity, returnPlaces } from "./consent-identity";

describe("consent identity", () => {
  it("does not use one familiar callback to brand an approved app with unrelated remote callbacks", () => {
    const cursor = "https://www.cursor.com/agents/mcp/oauth/callback";
    expect(approvedClientBrand("Cursor", "opaque", [cursor, "https://unrelated.example/cb"])).toBeNull();
    expect(approvedClientBrand("Cursor", "opaque", [cursor, "http://localhost:8787/callback"])).toBe("Cursor");
    expect(approvedClientBrand("Cursor", "opaque", [])).toBeNull();
  });
  it("shows the actual destination without a provider logo for a self-declared provider name", () => {
    expect(consentIdentity("Cursor", "opaque-id", "https://unrelated.example/callback")).toEqual({
      brand: null, destination: "Returns you to unrelated.example",
    });
    for (const name of ["Claude", "ChatGPT", "Grok", "Codex"]) {
      expect(consentIdentity(name, "opaque-id", "https://unrelated.example/callback").brand).toBeNull();
    }
  });
  it("brands only matching exact HTTPS callback hosts", () => {
    expect(consentIdentity("Cursor", "opaque", "https://www.cursor.com/agents/mcp/oauth/callback").brand).toBe("Cursor");
    expect(consentIdentity("Grok", "opaque", "https://grok.com/connectors-oauth-exchange-code/").brand).toBe("Grok");
    expect(consentIdentity("Claude", "opaque", "https://grok.com/callback").brand).toBeNull();
    for (const uri of ["https://cursor.com.evil.test/callback", "https://evil.test/cursor.com", "http://cursor.com/callback", "https://cursor.com:9443/callback", "https://cursor.com@evil.test/callback", "https://evil@cursor.com/callback"]) {
      expect(consentIdentity("Cursor", "opaque", uri).brand).toBeNull();
    }
  });
  it("uses a validated URL client ID for native clients but not self-declared loopback names", () => {
    expect(consentIdentity("Codex", "https://chatgpt.com/oauth/codex/client.json", "http://localhost:1455/auth/callback")).toEqual({
      brand: "Codex", destination: "Returns you to a program on this computer",
    });
    expect(consentIdentity("Cursor", "opaque", "http://localhost:8787/callback")).toEqual({
      brand: null, destination: "Returns you to a program on this computer",
    });
    expect(consentIdentity("Codex", "https://chatgpt.com.evil.test/client.json", "http://127.0.0.1:1455/callback").brand).toBeNull();
    expect(consentIdentity("Claude", "https://claude.ai/oauth/mcp-oauth-client-metadata", "https://claude.ai/api/mcp/auth_callback").brand).toBe("Claude");
  });
  it("handles malformed and native callbacks without hiding a remote host as localhost", () => {
    expect(consentIdentity("Cursor", "opaque", "invalid").destination).toBe("Return destination unavailable");
    expect(consentIdentity("Cursor", "opaque", "cursor://auth/callback").destination).toBe("Returns you to the cursor app");
    expect(consentIdentity("Cursor", "opaque", "http://localhost.evil.test/callback").destination).toBe("Returns you to localhost.evil.test");
    expect(consentIdentity("Cursor", "opaque", "http://[::1]:8787/callback").destination).toBe("Returns you to a program on this computer");
  });

  it("lists where an approved app sends you back, once each, so two connections of one app can be told apart", () => {
    expect(returnPlaces(["https://cursor.com/cb", "http://localhost:8787/callback", "https://cursor.com/other", "http://127.0.0.1:9/x"])).toEqual(["cursor.com", "This computer"]);
    expect(returnPlaces(["cursor://auth/callback"])).toEqual(["The cursor app"]);
    expect(returnPlaces(["http://localhost.evil.test/cb"])).toEqual(["localhost.evil.test"]);
    expect(returnPlaces(["not a url", "https://user:pw@grok.com/cb"])).toEqual([]);
  });
});
