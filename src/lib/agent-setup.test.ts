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

  it("installs the same five skills for every coding agent", () => {
    const names = ["queue-pilot", "queue-pilot-check-sources", "queue-pilot-check-week", "queue-pilot-fill-week", "queue-pilot-fix-drafts"];
    for (const dir of ["~/.claude/skills", "~/.agents/skills", "~/.cursor/skills"])
      for (const n of names) expect(setupPrompt(origin)).toContain(`mkdir -p ${dir}/${n} && curl -fsSL ${origin}/.well-known/agent-skills/${n}/SKILL.md -o ${dir}/${n}/SKILL.md`);
  });

  it("installs each skill's reference files beside its SKILL.md, at the paths its links use", () => {
    const prompt = setupPrompt(origin);
    for (const dir of ["~/.claude/skills", "~/.agents/skills", "~/.cursor/skills"])
      expect(prompt).toContain(`mkdir -p ${dir}/queue-pilot-fill-week/references && curl -fsSL ${origin}/.well-known/agent-skills/queue-pilot-fill-week/references/x.md -o ${dir}/queue-pilot-fill-week/references/x.md`);
  });

  it("does not make Codex sign in twice or install into the deprecated folder", () => {
    const p = setupPrompt(origin);
    expect(p).not.toContain("~/.codex/skills");
    const codex = p.slice(p.indexOf("## Codex"), p.indexOf("## Cursor"));
    expect(codex.match(/codex mcp login/g)).toHaveLength(1);
    expect(codex).toContain("Only if no browser opened");
    expect(codex.slice(0, codex.indexOf("Only if no browser opened"))).not.toContain("codex mcp login");
  });

  it("tells Claude Code to skip a second connector when the plugin already added one", () => {
    expect(setupPrompt(origin)).toContain("claude mcp list");
  });

  it("does not announce a connection before a real call works", () => {
    const p = setupPrompt(origin);
    const ending = p.slice(p.lastIndexOf("---"));
    expect(ending).toContain("installed, not connected");
    expect(ending).toContain("get_setup_status");
    expect(ending.indexOf("get_setup_status")).toBeLessThan(ending.indexOf("Queue Pilot connected"));
    expect(ending).toContain("Queue Pilot installed, sign-in still needed");
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
