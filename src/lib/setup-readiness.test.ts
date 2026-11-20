/**
 * @fileoverview The Home setup steps for someone without Buffer: the first step asks them to connect where they post,
 * and never claims a Buffer account they do not have.
 */
import { describe, expect, it } from "vitest";
import { setupReadiness } from "./setup-readiness";

describe("setupReadiness without Buffer", () => {
  it("asks to connect where you post, never claiming a Buffer account", () => {
    const [first] = setupReadiness({ channels: [], noBuffer: true }, [], [], null);
    expect(first).toMatchObject({ label: "Connect where you post", state: "todo", href: "/settings?tab=channels" });
    expect(JSON.stringify(first)).not.toMatch(/Buffer account is connected/);
  });
  it("is done once an account is connected, naming it", () => {
    expect(setupReadiness({ channels: [], noBuffer: true }, [], [], null, false, ["@ada@mastodon.social"])[0]).toMatchObject({ label: "Accounts connected", state: "done", detail: "@ada@mastodon.social" });
  });
  it("control: a Buffer person's first step is unchanged", () => {
    expect(setupReadiness({ channels: [] }, [], [], null)[0].label).toBe("No channels in your Buffer yet");
  });
});
