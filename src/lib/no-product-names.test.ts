import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Code, comments and shipped docs describe Queue Pilot's own behaviour. They never cite other products or link to
// private research notes. Integrations Queue Pilot talks to (Buffer, the AI providers, Telegram, Discord) are fine.
const BANNED = /\b(Cal\.com|cal\.diy|calcom|Formbricks|Documenso|Postiz|Plausible|Umami|Discourse|WordPress|LibreChat|Dify|Unkey|Fly ?Whenever|AgentDock|Seller Desk|Deputy|Vale|Hootsuite|Sprout Social|Later\.com|Typefully|Hypefury|Publer|Metricool)\b|research\//i;
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

  it("finds none", () => {
    const hits = targets.filter((f) => !f.endsWith("no-product-names.test.ts")).flatMap((f) =>
      readFileSync(f, "utf8").split("\n").flatMap((line, i) => (BANNED.test(line) ? [`${f.slice(ROOT.length + 1)}:${i + 1}`] : [])),
    );
    expect(hits).toEqual([]);
  });
});
