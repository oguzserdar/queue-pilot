import { describe, expect, it } from "vitest";
import config from "../../next.config";

const rules = async () => (await config.headers!()) as { source: string; headers: { key: string; value: string }[] }[];
const keys = (h: { key: string }[]) => h.map((x) => x.key);

describe("security headers", () => {
  it("refuse framing on every page except /embed, which shows example data only", async () => {
    const [pages, embed] = await rules();
    expect(new RegExp(`^${pages.source}$`).test("/consent")).toBe(true);
    expect(new RegExp(`^${pages.source}$`).test("/admin")).toBe(true);
    expect(new RegExp(`^${pages.source}$`).test("/embed/week")).toBe(false);
    expect(keys(pages.headers)).toEqual(expect.arrayContaining(["X-Frame-Options", "Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy"]));
    expect(keys(embed.headers)).not.toContain("X-Frame-Options");
  });
  it("send HSTS only in production, so a self-hosted copy on http during setup is not locked out", async () => {
    const [pages] = await rules();
    expect(keys(pages.headers)).not.toContain("Strict-Transport-Security");
  });
});
