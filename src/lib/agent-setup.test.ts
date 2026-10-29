/**
 * @fileoverview The agent setup prompt: every command points at this deployment, never at another address, and the
 * copied line points at the prompt itself.
 */
import { describe, expect, it } from "vitest";
import { setupLine, setupPrompt } from "./agent-setup";

const origin = "https://qp.example.com";

describe("agent setup prompt", () => {
  it("connects each agent to this deployment's connector and skill", () => {
    const p = setupPrompt(origin);
    expect(p).toContain(`claude mcp add --transport http --scope user queue-pilot ${origin}/api/mcp`);
    expect(p).toContain(`codex mcp add queue-pilot --url ${origin}/api/mcp`);
    expect(p).toContain(`curl -fsSL ${origin}/.well-known/agent-skills/queue-pilot/SKILL.md`);
  });

  it("names no other address", () => {
    const urls = setupPrompt(origin).match(/https?:\/\/[^\s"`)]+/g) ?? [];
    expect(urls.length).toBeGreaterThan(3);
    for (const u of urls) expect(u.startsWith(origin)).toBe(true);
  });

  it("copies one line that points at the prompt", () => {
    expect(setupLine(origin)).toBe(`Fetch and follow the instructions to connect me to Queue Pilot from ${origin}/agent-setup/prompt.md`);
  });
});
