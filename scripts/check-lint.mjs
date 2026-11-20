#!/usr/bin/env node
/**
 * The code-quality gate: runs oxlint (rules in .oxlintrc.json, type-aware on TypeScript 7) and compares the problems
 * per file and rule with scripts/lint-baseline.json.
 *
 * - A count above its baseline fails: new code must pass every rule.
 * - A count below its baseline also fails, until the baseline is lowered with `--lower`: fixes are locked in.
 * - `--lower` only ever lowers counts. It refuses to run while any count is above its baseline.
 *
 * Usage: node scripts/check-lint.mjs [--lower]
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const baselinePath = resolve(root, "scripts/lint-baseline.json");

/** Problems per "file|rule" for the current tree. */
function countNow() {
  const run = spawnSync(resolve(root, "node_modules/.bin/oxlint"), ["--type-aware", "-f", "json", "src", "scripts"], {
    cwd: root, encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
  });
  if (run.error || !run.stdout) throw new Error(`oxlint did not run: ${run.error?.message ?? run.stderr}`);
  const parsed = JSON.parse(run.stdout);
  const diagnostics = Array.isArray(parsed) ? parsed : parsed.diagnostics;
  const counts = {};
  for (const d of diagnostics) {
    const key = `${relative(root, resolve(root, d.filename))}|${d.code}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

/** Keys whose count differs from the baseline, split into above and below. */
function compare(now, baseline) {
  const above = [];
  const below = [];
  for (const key of new Set([...Object.keys(now), ...Object.keys(baseline)])) {
    const n = now[key] ?? 0;
    const b = baseline[key] ?? 0;
    if (n > b) above.push(`${key}: ${n} (allowed ${b})`);
    if (n < b) below.push(`${key}: ${n} (baseline ${b})`);
  }
  return { above: above.sort(), below: below.sort() };
}

/** Files with a comment that switches a check off; none are allowed outside Arc's copied code. */
function disableComments() {
  const run = spawnSync("grep", ["-rlE", "eslint-disable|oxlint-disable|@ts-ignore|@ts-expect-error|@ts-nocheck", "src", "scripts",
    "--include=*.ts", "--include=*.tsx", "--include=*.mjs", "--exclude-dir=registry"], { cwd: root, encoding: "utf8" });
  return run.stdout.split("\n").filter((f) => f && f !== "scripts/check-lint.mjs" && !ARC_FILES.has(f));
}
// Arc's own files copied outside src/registry (third-party/arc/NOTICE); they move with the Arc install.
const ARC_FILES = new Set(Object.keys(JSON.parse(readFileSync(resolve(root, "scripts/registry-upstream.json"), "utf8")).lib));

const disabled = disableComments();
if (disabled.length) {
  console.error(`Code-quality gate: ${disabled.length} file(s) switch a check off with a comment. Fix the code instead:`);
  for (const f of disabled) console.error(`  ${f}`);
  process.exit(1);
}

const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
const now = countNow();
const { above, below } = compare(now, baseline);

if (above.length) {
  console.error(`Code-quality gate: ${above.length} file and rule pair(s) got worse. Fix the code; never raise the baseline.`);
  for (const line of above) console.error(`  ${line}`);
  process.exit(1);
}
if (process.argv.includes("--lower")) {
  const lowered = Object.fromEntries(Object.entries(now).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(baselinePath, `${JSON.stringify(lowered, null, 2)}\n`);
  console.log(`Baseline lowered: ${below.length} pair(s); ${Object.values(now).reduce((t, n) => t + n, 0)} problems left.`);
  process.exit(0);
}
if (below.length) {
  console.error(`Code-quality gate: ${below.length} pair(s) improved. Lock it in: node scripts/check-lint.mjs --lower`);
  for (const line of below) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`Code-quality gate passed: ${Object.values(now).reduce((t, n) => t + n, 0)} known problems, none new.`);
