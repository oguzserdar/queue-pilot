#!/usr/bin/env node
/**
 * Commit message check, run by the commit-msg hook. The subject follows Conventional Commits
 * (https://www.conventionalcommits.org), the same rule CI applies to pull request titles.
 *
 * @example
 * node scripts/check-commit-message.mjs .git/COMMIT_EDITMSG
 */
import { readFileSync } from "node:fs";

const TYPES = ["feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert"];
const subject = readFileSync(process.argv[2], "utf8").split("\n")[0];
const pattern = new RegExp(`^(${TYPES.join("|")})(\\([a-z0-9-]+\\))?!?: \\S.{0,70}$`);

// Merge and revert subjects are written by git itself.
if (!/^(Merge|Revert) /.test(subject) && !pattern.test(subject)) {
  console.error(`Commit subject must look like "feat(week): show the failing post first" (72 characters at most).`);
  console.error(`Types: ${TYPES.join(", ")}. Got: "${subject}"`);
  process.exit(1);
}
