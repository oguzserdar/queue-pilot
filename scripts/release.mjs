#!/usr/bin/env node
/**
 * Cuts a release: `pnpm release 0.3.0 "Every AI"`.
 * Moves CHANGELOG.md's "Unreleased" notes under the new version with today's date, sets package.json's version,
 * commits and tags `v0.3.0`. Pushing the tag (`git push --follow-tags`) opens a draft GitHub Release with those notes
 * (.github/workflows/release.yml). Attach the day's video, then publish the draft to build the Docker image.
 * Refuses when the version is not semver, is not above the current one, or "Unreleased" is empty.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const [version, name = ""] = process.argv.slice(2);
const fail = (msg) => { console.error(`release: ${msg}`); process.exit(1); };

if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version ?? "")) fail('give a version, e.g. pnpm release 0.3.0 "Every AI"');

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const parts = (v) => v.split("-")[0].split(".").map(Number);
const [a, b] = [parts(version), parts(pkg.version)];
const newer = a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
if (newer <= 0) fail(`${version} is not above the current ${pkg.version}`);

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
if (git("status", "--porcelain")) fail("commit or stash your changes first");

const log = readFileSync("CHANGELOG.md", "utf8");
const start = log.indexOf("## [Unreleased]");
if (start < 0) fail('CHANGELOG.md has no "## [Unreleased]" section');
const bodyStart = log.indexOf("\n", start) + 1;
const next = log.indexOf("\n## [", bodyStart);
const notes = log.slice(bodyStart, next < 0 ? undefined : next).trim();
if (!notes) fail('"Unreleased" is empty: nothing to release');

const date = new Date().toISOString().slice(0, 10);
const heading = `## [${version}] - ${date}${name ? ` ${name}` : ""}`;
writeFileSync("CHANGELOG.md", `${log.slice(0, bodyStart)}\n${heading}\n\n${notes}\n${next < 0 ? "" : log.slice(next)}`);
writeFileSync("package.json", `${JSON.stringify({ ...pkg, version }, null, 2)}\n`);
const pluginPath = "plugin/.claude-plugin/plugin.json";
const plugin = JSON.parse(readFileSync(pluginPath, "utf8"));
writeFileSync(pluginPath, `${JSON.stringify({ ...plugin, version }, null, 2)}\n`);

git("add", "CHANGELOG.md", "package.json", pluginPath);
git("commit", "-m", `chore(release): v${version}${name ? ` ${name}` : ""}`);
git("tag", "-a", `v${version}`, "-m", `v${version}${name ? ` ${name}` : ""}`);
console.log(`Tagged v${version}. Publish with: git push --follow-tags`);
