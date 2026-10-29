import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Owner rule (21 Oct 2026): the "nothing goes out until you approve" reassurance appears only in Settings, where it
// labels the real always-on setting. Repeating it on every screen makes the product sound like it does nothing.
const ALLOWED = new Set(["components/settings-view.tsx"]);
const BANNED = /until you approve|nothing (is scheduled|goes out|reaches buffer)|never posts on its own/i;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return files(p);
    return /\.(tsx?|css)$/.test(name) && !/\.test\./.test(name) ? [p] : [];
  });
}

describe("copy rules", () => {
  it("the approval reassurance appears only in Settings", () => {
    const root = join(__dirname, "..");
    const all = files(root);
    // Control: the scan must see the one file that is allowed to contain the line.
    expect(all.some((f) => f.endsWith("components/settings-view.tsx"))).toBe(true);
    const offenders = all.filter((f) => !ALLOWED.has(f.slice(root.length + 1)) && BANNED.test(readFileSync(f, "utf8")));
    expect(offenders.map((f) => f.slice(root.length + 1))).toEqual([]);
  });

  it("every connector address shown to users is the authenticated /api/mcp, never the old /mcp test route", () => {
    const root = join(__dirname, "..");
    const all = files(root);
    // Control: the scan sees the connect page, which builds the address.
    expect(all.some((f) => f.endsWith("app/(app)/connect/page.tsx"))).toBe(true);
    const offenders = all.filter((f) => /\}\/mcp[`"']/.test(readFileSync(f, "utf8"))).map((f) => f.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });

  it("never promises drafting without the user's own AI (not built)", () => {
    const root = join(__dirname, "..");
    const offenders = files(root).filter((f) => /built-in model|small model on our side/i.test(readFileSync(f, "utf8"))).map((f) => f.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });

  it("never names a domain we do not own yet", () => {
    const root = join(__dirname, "..");
    const offenders = files(root).filter((f) => /getqueuepilot\.com/i.test(readFileSync(f, "utf8"))).map((f) => f.slice(root.length + 1));
    expect(offenders).toEqual([]);
  });
});

it("does not claim the app can never schedule when Approve schedules", () => {
  const root = join(__dirname, "..");
  const absoluteClaim = /Queue Pilot never schedules or publishes(?: anything)?\./i;
  expect(absoluteClaim.test("Queue Pilot never schedules or publishes.")).toBe(true);
  expect(absoluteClaim.test("Queue Pilot never schedules or publishes on its own.")).toBe(false);
  const publicDocs = ["README.md", "CONTRIBUTING.md", "ROADMAP.md", "docs/buffer-api-notes.md"];
  const all = [...files(root), ...publicDocs.map((file) => join(root, "..", file))];
  expect(all.filter((file) => absoluteClaim.test(readFileSync(file, "utf8")))).toEqual([]);
});
