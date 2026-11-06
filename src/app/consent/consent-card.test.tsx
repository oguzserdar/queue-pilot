/**
 * @fileoverview The consent screen shows an app's name as a name only when its registered address proves it; any
 * other name is the app's own claim and is labelled unverified.
 */
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ConsentCard } from "./consent-card";

const user = { name: "Alex Rivera", email: "alex@thisweekinai.example" };
const card = (client: string, clientId: string, redirectUri: string) => renderToStaticMarkup(<ConsentCard client={client} clientId={clientId} redirectUri={redirectUri} user={user} scopes={[]}><span /></ConsentCard>);

describe("consent card", () => {
  it("shows a proven app's name in bold, without the unverified label", () => {
    const html = card("claude.ai", "https://claude.ai/oauth/mcp-oauth-client-metadata", "https://claude.ai/api/mcp/auth_callback");
    expect(html).toContain("<strong>Claude</strong> wants to connect");
    expect(html).not.toContain("Unverified app");
  });

  it("labels a self-declared name as unverified and never bolds it", () => {
    const html = card("Claude", "dyn-123", "https://evil.example/callback");
    expect(html).toContain("Unverified app: <bdi>Claude</bdi> wants to connect");
    expect(html).not.toContain("<strong>Claude</strong>");
    expect(html).toContain("cannot confirm who made this app");
  });
});
