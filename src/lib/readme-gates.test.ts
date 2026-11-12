/**
 * @fileoverview Checks that keep the README true to the repository: every image and file it links exists, every image
 * says what it shows, screenshots carry no hidden metadata, no screenshot sits unused, every connector tool it names
 * exists, and the first-session cost table adds up. The connector's own tool table in docs/connector-controls.md is
 * held to the code the same way. Copy rules and the settings table have their own tests.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "../..");
const readme = readFileSync(join(root, "README.md"), "utf8");
const images = [...readme.matchAll(/!\[([^\]]*)\]\(([^)]+)\)|<img alt="([^"]*)" src="([^"]+)"|srcset="([^"]+)"/g)].map((m) => ({ alt: m[1] ?? m[3] ?? null, src: m[2] ?? m[4] ?? m[5] }));
const localLinks = [...readme.matchAll(/\]\((?!https?:|#|mailto:)([^)\s]+)\)/g)].map((m) => m[1].split("#")[0]);

/** Every tool the connector registers, read from its source files. */
function registeredTools(): Set<string> {
  const sources = readdirSync(join(root, "src/lib")).filter((f) => f.startsWith("mcp-") && f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => join(root, "src/lib", f));
  const code = [join(root, "src/app/api/mcp/route.ts"), ...sources].map((f) => readFileSync(f, "utf8")).join("\n");
  return new Set([...code.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]));
}

/** PNG chunk types other than the ones needed to draw the image (text, time, EXIF, XMP and the like). */
function metadataChunks(file: string): string[] {
  const d = readFileSync(file);
  const keep = new Set(["IHDR", "PLTE", "IDAT", "IEND", "tRNS", "sRGB", "gAMA", "cHRM", "pHYs", "bKGD"]);
  const found: string[] = [];
  for (let i = 8; i < d.length; ) {
    const n = d.readUInt32BE(i);
    const type = d.toString("latin1", i + 4, i + 8);
    if (!keep.has(type)) found.push(type);
    i += 12 + n;
  }
  return found;
}

describe("README", () => {
  it("links only to files and images that exist", () => {
    const missing = [...new Set([...images.map((i) => i.src), ...localLinks])].filter((p) => !existsSync(join(root, p)));
    expect(missing).toEqual([]);
  });

  it("describes what every image shows", () => {
    const vague = images.filter((i) => i.alt !== null && i.alt.trim().split(/\s+/).length < 6).map((i) => i.src);
    expect(vague).toEqual([]);
  });

  it("ships screenshots without hidden metadata", () => {
    const dirty = images.filter((i) => i.src.endsWith(".png")).map((i) => [i.src, metadataChunks(join(root, i.src))] as const).filter(([, c]) => c.length);
    expect(dirty).toEqual([]);
  });

  it("keeps no unused screenshots in docs/media", () => {
    const docs = [readme, ...readdirSync(join(root, "docs")).filter((f) => f.endsWith(".md")).map((f) => readFileSync(join(root, "docs", f), "utf8"))].join("\n");
    const unused = readdirSync(join(root, "docs/media")).filter((f) => !docs.includes(`media/${f}`));
    expect(unused).toEqual([]);
  });

  it("names only connector tools that exist", () => {
    const registered = registeredTools();
    const named = [...new Set([...readme.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]))];
    expect(registered.size).toBeGreaterThan(20);
    expect(named.filter((t) => !registered.has(t))).toEqual([]);
  });

  it("has a first-session cost table that adds up", () => {
    const rows = [...readme.matchAll(/^\| ([^|*]+?) \| (\d+) \|$/gm)].map((m) => Number(m[2]));
    const total = Number(readme.match(/\| \*\*First session\*\* \| \*\*(\d+)\*\* \|/)?.[1]);
    expect(rows.length).toBeGreaterThan(3);
    expect(rows.reduce((a, b) => a + b, 0)).toBe(total);
  });
});

describe("docs/connector-controls.md", () => {
  it("lists exactly the tools the connector registers, and says how many", () => {
    const doc = readFileSync(join(root, "docs/connector-controls.md"), "utf8");
    const rows = doc.split("\n").filter((l) => l.startsWith("| "));
    const listed = new Set(rows.flatMap((l) => [...l.matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1])));
    const registered = registeredTools();
    expect([...registered].filter((t) => !listed.has(t))).toEqual([]);
    expect([...listed].filter((t) => !registered.has(t))).toEqual([]);
    expect(Number(doc.match(/exposes (\d+) tools/)?.[1])).toBe(registered.size);
  });
});
