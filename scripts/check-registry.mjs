#!/usr/bin/env node
/**
 * src/registry is the Arc library (THIRD_PARTY_NOTICES.md), and the lint gate skips it (.oxlintrc.json). This check
 * keeps that honest by content, not by name: every file must be byte for byte Arc's own at the pinned commit, or one
 * of our recorded patches, unchanged since it was recorded. Both lists are in scripts/registry-upstream.json:
 * `files` (Arc's blob hashes) and `ourPatches` (our hash and why we changed it). So none of our code can sit in the
 * folder unchecked, and a patched Arc file cannot be edited further without saying so.
 *
 * Usage: node scripts/check-registry.mjs
 */
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const folder = resolve(root, "src/registry");
const record = JSON.parse(readFileSync(resolve(root, "scripts/registry-upstream.json"), "utf8"));

/** Every file under a folder, as paths relative to it. */
function filesIn(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return filesIn(full);
    return e.name === ".DS_Store" ? [] : [relative(folder, full)];
  });
}

const paths = filesIn(folder);
// git's blob hash of each file, the same hash GitHub lists for Arc's tree, so the two compare directly.
const hashes = execFileSync("git", ["hash-object", "--stdin-paths"], { cwd: root, input: paths.map((p) => join(folder, p)).join("\n"), encoding: "utf8" }).trim().split("\n");

const problems = paths.flatMap((p, i) => {
  const hash = hashes[i];
  if (record.files[p] === hash) return [];
  const patch = record.ourPatches[p];
  if (!patch) return [record.files[p] ? `${p}: changed from Arc's copy without a recorded reason` : `${p}: not one of Arc's files`];
  return patch.sha === hash ? [] : [`${p}: our patch changed again since it was recorded`];
});

// Arc's lib/ helpers live in src/lib, unchanged; lint skips them too, so they are held to Arc's copy the same way.
const libPaths = Object.keys(record.lib);
const libHashes = execFileSync("git", ["hash-object", "--stdin-paths"], { cwd: root, input: libPaths.map((p) => join(root, p)).join("\n"), encoding: "utf8" }).trim().split("\n");
problems.push(...libPaths.flatMap((p, i) => (libHashes[i] === record.lib[p] ? [] : [`${p}: changed from Arc's copy; Arc's files are kept as Arc wrote them`])));

if (problems.length) {
  console.error(`src/registry: ${problems.length} file(s) are not Arc's own or a recorded patch. Our own code belongs outside it, where lint checks it; a needed Arc change gets its hash and reason in scripts/registry-upstream.json:`);
  for (const line of problems) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`src/registry: ${paths.length} files, each Arc's own or one of ${Object.keys(record.ourPatches).length} recorded patches.`);
