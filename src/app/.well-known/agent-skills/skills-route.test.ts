/**
 * @fileoverview The skill route serves each known skill and nothing else.
 */
import { createHash } from "node:crypto";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { PLUGIN_SKILL_FILES, PLUGIN_SKILLS } from "@/lib/plugin-skills";
import { GET } from "./[name]/SKILL.md/route";
import { GET as getFile } from "./[name]/[...path]/route";
import { GET as getZip } from "./[name]/skill.zip/route";
import { GET as getIndex } from "./index.json/route";

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

describe("skill reference files", () => {
  const file = (name: string, path: string[]) => getFile(new Request("https://qp.example.com/x"), { params: Promise.resolve({ name, path }) });
  const zip = (name: string) => getZip(new Request("https://qp.example.com/x"), { params: Promise.resolve({ name }) });

  it("control: at least one skill ships a reference file", () => {
    expect(Object.keys(PLUGIN_SKILL_FILES["queue-pilot-fill-week"] ?? {})).toContain("references/x.md");
  });

  it("serves each shipped file at its path inside the skill", async () => {
    for (const [name, files] of Object.entries(PLUGIN_SKILL_FILES)) {
      for (const [path, text] of Object.entries(files)) {
        const res = await file(name, path.split("/"));
        expect(res.status).toBe(200);
        expect(await res.text()).toBe(text);
      }
    }
  });

  it("answers 404 for paths a skill does not ship, traversal and object property names", async () => {
    for (const [name, path] of [["queue-pilot-fill-week", ["nope.md"]], ["queue-pilot-fill-week", ["..", "..", ".env"]], ["queue-pilot-fill-week", ["__proto__"]], ["constructor", ["x"]], ["queue-pilot-check-week", ["references", "x.md"]]] as const)
      expect((await file(name, [...path])).status).toBe(404);
  });

  it("lists a skill with reference files as an archive whose digest and contents match what is served", async () => {
    const index = await (await getIndex(new Request("https://qp.example.com/.well-known/agent-skills/index.json"))).json();
    for (const name of Object.keys(PLUGIN_SKILL_FILES)) {
      const entry = index.skills.find((s: { name: string }) => s.name === name);
      expect(entry).toMatchObject({ type: "archive", url: `/.well-known/agent-skills/${name}/skill.zip` });
      const bytes = new Uint8Array(await (await zip(name)).arrayBuffer());
      expect(entry.digest).toBe(`sha256:${createHash("sha256").update(bytes).digest("hex")}`);
      const files = Object.fromEntries(Object.entries(unzipSync(bytes)).map(([p, b]) => [p, new TextDecoder().decode(b)]));
      // SKILL.md sits at the archive's root: installers read it from there, not from a folder inside.
      expect(files).toEqual({ "SKILL.md": PLUGIN_SKILLS[name], ...PLUGIN_SKILL_FILES[name] });
    }
  });

  it("keeps single-file skills as SKILL.md entries with no archive", async () => {
    const index = await (await getIndex(new Request("https://qp.example.com/.well-known/agent-skills/index.json"))).json();
    expect(index.skills.find((s: { name: string }) => s.name === "queue-pilot-check-week")).toMatchObject({ type: "skill-md" });
    expect((await zip("queue-pilot-check-week")).status).toBe(404);
    expect((await zip("__proto__")).status).toBe(404);
  });

  it("builds the same archive bytes every time", async () => {
    const a = new Uint8Array(await (await zip("queue-pilot-fill-week")).arrayBuffer());
    const b = new Uint8Array(await (await zip("queue-pilot-fill-week")).arrayBuffer());
    expect(a).toEqual(b);
  });
});
