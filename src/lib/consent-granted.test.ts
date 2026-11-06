/**
 * @fileoverview Which /oauth2/consent requests count as a granted AI app: only an accepted Allow that Better Auth did
 * not refuse, for a signed-in person, with the app named in the signed query.
 */
import { describe, expect, it } from "vitest";
import { APIError } from "better-auth/api";
import { consentGranted } from "./consent-granted";

const query = "client_id=claude-x&scope=openid&sig=abc";
const ok = { path: "/oauth2/consent", body: { accept: true, oauth_query: query }, context: { returned: { redirect: true, url: "https://claude.ai/cb?code=1" }, session: { user: { id: "u1" } } } };

describe("consent granted", () => {
  it("names the person and the app for an accepted Allow", () => {
    expect(consentGranted(ok)).toEqual({ userId: "u1", clientId: "claude-x" });
  });

  it("ignores a Deny, another path, a refused request and a missing session", () => {
    expect(consentGranted({ ...ok, body: { accept: false, oauth_query: query } })).toBeNull();
    expect(consentGranted({ ...ok, path: "/oauth2/token" })).toBeNull();
    expect(consentGranted({ ...ok, context: { ...ok.context, returned: new APIError("BAD_REQUEST") } })).toBeNull();
    expect(consentGranted({ ...ok, context: { ...ok.context, session: null } })).toBeNull();
    expect(consentGranted({ ...ok, body: { accept: true } })).toBeNull();
  });
});
