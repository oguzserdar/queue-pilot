/**
 * @fileoverview The security headers next.config sends: a Content-Security-Policy baseline on every page, with
 * /embed/* the one place that may be framed.
 */
import { describe, expect, it } from "vitest";
import { nextConfig } from "./next.config";

type Header = { key: string; value: string };

async function headersFor(source: string): Promise<Header[]> {
  const rules = (await nextConfig.headers!()) as { source: string; headers: Header[] }[];
  const rule = rules.find((r) => r.source === source);
  if (!rule) throw new Error(`no header rule for ${source}`);
  return rule.headers;
}

/** The policy as directive name to its sources, so order and spacing do not matter. */
function csp(headers: Header[]): Map<string, string[]> {
  const value = headers.find((h) => h.key === "Content-Security-Policy")?.value ?? "";
  return new Map(value.split(";").map((d) => d.trim().split(/\s+/)).filter((d) => d[0]).map(([name, ...sources]) => [name, sources]));
}

const PAGES = "/((?!embed/).*)";
const EMBED = "/embed/:path*";

describe("Content-Security-Policy", () => {
  for (const source of [PAGES, EMBED]) {
    it(`blocks plugins, base rewrites and foreign form targets on ${source}`, async () => {
      const policy = csp(await headersFor(source));
      expect(policy.get("object-src")).toEqual(["'none'"]);
      expect(policy.get("base-uri")).toEqual(["'self'"]);
      expect(policy.get("form-action")).toEqual(["'self'"]);
    });

    it(`allows scripts only from this site on ${source}, without eval outside development`, async () => {
      expect(csp(await headersFor(source)).get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    });
  }

  it("refuses framing on every page except /embed", async () => {
    const pages = await headersFor(PAGES);
    expect(csp(pages).get("frame-ancestors")).toEqual(["'none'"]);
    expect(pages.find((h) => h.key === "X-Frame-Options")?.value).toBe("DENY");
  });

  it("lets /embed be framed", async () => {
    const embed = await headersFor(EMBED);
    expect(csp(embed).has("frame-ancestors")).toBe(false);
    expect(embed.some((h) => h.key === "X-Frame-Options")).toBe(false);
  });
});
