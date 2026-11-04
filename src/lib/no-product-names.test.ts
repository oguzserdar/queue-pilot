import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Code, comments and shipped docs describe Queue Pilot's own behaviour. They never cite other products or link to
// private research notes. Integrations Queue Pilot talks to (Buffer, the AI providers, Telegram, Discord) are fine.
const BANNED = /\b(Cal\.com|cal\.diy|calcom|Formbricks|Documenso|Postiz|Plausible|Umami|Discourse|WordPress|LibreChat|Dify|Unkey|Fly ?Whenever|AgentDock|Seller Desk|Deputy|Vale|Hootsuite|Sprout Social|Later\.com|Typefully|Hypefury|Publer|Metricool)\b|research\//i;
// Names that must not even be spelled here, so this gate never writes them into the history: matched by the
// SHA-256 of a word, or of two neighbouring words run together, lowercased with punctuation removed.
const HIDDEN = new Set([
  "c6232ad186e556b92c5609f807d0ecc1a4df4746b99ab64ec84b7e1c933fd4c4",
  "60d9b14e6eb7a1e5943c45e093f08f8a77793bdf1952c884da2facb8bc73779b",
]);
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
function hidden(line: string) {
  const words = line.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.some((w, i) => HIDDEN.has(sha(w)) || (i > 0 && HIDDEN.has(sha(words[i - 1] + w))));
}
const named = (line: string) => BANNED.test(line) || hidden(line);
const ROOT = join(__dirname, "../..");
const SKIP = new Set(["node_modules", ".next", "fixtures", "drizzle", ".git"]);

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx|mjs|css|md|yml|yaml)$/.test(name) ? [p] : [];
  });
}

describe("no other products named in the code or docs", () => {
  const targets = [...files(join(ROOT, "src")), ...files(join(ROOT, "scripts")), ...files(join(ROOT, ".github")), ...["README.md", "CHANGELOG.md", "CONTRIBUTING.md", "SECURITY.md", "ROADMAP.md", "next.config.ts", "Dockerfile", "docker-compose.yml", ".env.example"].map((f) => join(ROOT, f))];

  it("control: the pattern catches a name", () => {
    expect(BANNED.test("as Formbricks does")).toBe(true);
  });

  it("control: the hidden names are caught in any spelling, and plain words are not", () => {
    const name = String.fromCharCode(109, 97, 103, 105, 99);
    expect(named(`from ${name}ui`)).toBe(true);
    expect(named(`a ${name}-UI kit`)).toBe(true);
    expect(named(`a ${name} ui kit`)).toBe(true);
    expect(named("a rough sketch line, drawn by a steady hand")).toBe(false);
  });

  it("finds none", () => {
    const hits = targets.filter((f) => !f.endsWith("no-product-names.test.ts")).flatMap((f) =>
      readFileSync(f, "utf8").split("\n").flatMap((line, i) => (named(line) ? [`${f.slice(ROOT.length + 1)}:${i + 1}`] : [])),
    );
    expect(hits).toEqual([]);
  });
});
