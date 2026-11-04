/**
 * @fileoverview The skill route serves each known skill and nothing else.
 */
import { describe, expect, it } from "vitest";
import { GET } from "./[name]/SKILL.md/route";

const get = (name: string) => GET(new Request("https://qp.example.com/.well-known/agent-skills/x/SKILL.md"), { params: Promise.resolve({ name }) });

describe("skill route", () => {
  it("serves the main skill with this deployment's address", async () => {
    const res = await get("queue-pilot");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("/api/mcp");
  });

  it("serves a plugin task skill", async () => {
    const res = await get("queue-pilot-fill-week");
    expect(res.status).toBe(200);
    expect(await res.text()).toMatch(/^---\nname: queue-pilot-fill-week/);
  });

  it("answers 404 for anything else, including object property names", async () => {
    for (const n of ["nope", "constructor", "__proto__", "../x"]) expect((await get(n)).status).toBe(404);
  });
});
