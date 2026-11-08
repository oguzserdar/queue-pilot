/**
 * @fileoverview The weekly check of X's ranking code: it reads the pin from the X notes, reports only the files the
 * notes rely on, says "nothing to do" when they did not change, and never edits the notes itself.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NOTES, WATCHED, lineChanges, notice, pinned, watchedChanges } from "../../scripts/check-x-ranking.mjs";

const pin = { repo: "xai-org/x-algorithm", commit: "3b6919f87532e57063bb3f1e85c2f509323b513e", checked: "2026-11-08" };

describe("X ranking check", () => {
  it("reads the checked date and pinned commit from the notes the skill ships", () => {
    expect(pinned(readFileSync(NOTES, "utf8"))).toEqual(pin);
    expect(pinned("# no source here")).toBeNull();
  });

  it("unchanged: says there is nothing to do when no watched file moved", () => {
    const changes = watchedChanges({ commits: [{ sha: "a".repeat(40) }], files: [{ filename: "README.md", status: "modified", patch: "+x" }] });
    expect(changes.files).toEqual([]);
    expect(notice(pin, changes)).toContain("No change in the files the notes rely on. Nothing to do.");
  });

  it("changed: lists each watched file with its changed lines and asks for a verified update in one pull request", () => {
    const changes = watchedChanges({
      commits: [{ sha: "b".repeat(40) }],
      files: [
        { filename: "home-mixer/params/param.rs", status: "modified", blob_url: "https://example.test/param.rs", patch: "@@ -1 +1 @@\n-param!(FavoriteWeight, f64, \"w\", 0.708);\n+param!(FavoriteWeight, f64, \"w\", 0.75);" },
        { filename: "docs/other.md", status: "modified", patch: "+x" },
      ],
    });
    expect(changes.files.map((f: { path: string }) => f.path)).toEqual(["home-mixer/params/param.rs"]);
    const text = notice(pin, changes);
    expect(text).toContain("1 file(s) the notes rely on changed");
    expect(text).toContain("+param!(FavoriteWeight, f64, \"w\", 0.75);");
    expect(text).toContain("update its Checked date and Source commit in one pull request");
  });

  it("compares the two versions itself when GitHub leaves a patch out", () => {
    expect(lineChanges("a\nlike 0.66\nb", "a\nlike 0.708\nb")).toEqual(["-like 0.66", "+like 0.708"]);
  });

  it("watches every file the notes' numbers came from", () => {
    expect(WATCHED).toContain("home-mixer/params/param.rs");
    expect(new Set(WATCHED).size).toBe(WATCHED.length);
  });
});
