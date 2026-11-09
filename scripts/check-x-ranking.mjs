// Weekly check of X's open-source ranking code against the commit the fill-week skill's X notes were checked at.
// It reports which of the files the notes rely on changed since then, as a notice a person reviews. It never edits
// the notes: their date and commit change only after someone has read the change and verified the new numbers.
import { readFileSync } from "node:fs";

export const NOTES = "plugin/skills/queue-pilot-fill-week/references/x.md";

/** The files the notes' numbers and rules were read from. A change anywhere else in the repository is not reported. */
export const WATCHED = [
  "home-mixer/params/param.rs",
  "home-mixer/params/config.rs",
  "home-mixer/scorers/value_model.rs",
  "home-mixer/scorers/author_cold_start.rs",
  "home-mixer/scorers/phoenix_scorer.rs",
  "home-mixer/filters/oon_retweet_reply_filter.rs",
  "vm-ranker/params.rs",
  "xai-value-model/scoring.rs",
  "xai-value-model/weights.rs",
  "xai-value-model/inputs.rs",
  "visibility-filtering/rules/tweet_rules.rs",
  "grox/flows/reply_spam/constants.py",
  "abuse-enforcement-service/types/src/action_control.rs",
  "phoenix-rankall-strato/lib/eventProcessing.strato",
];

/**
 * The repository and commit the notes were checked against, read from their Source line.
 *
 * @param text - The notes file
 * @returns owner/repo and the full commit, or null when the Source line is missing or malformed
 */
export function pinned(text) {
  const m = text.match(/^Source: .*https:\/\/github\.com\/([\w.-]+\/[\w.-]+) at commit ([0-9a-f]{40})$/m);
  const checked = text.match(/^Checked: (\d{4}-\d{2}-\d{2})$/m);
  return m && checked ? { repo: m[1], commit: m[2], checked: checked[1] } : null;
}

/**
 * What changed in the watched files between the pinned commit and the latest one.
 *
 * @param compare - GitHub's compare response for pinned...latest
 * @returns The latest commit and each changed watched file with its link and the lines that changed
 */
export function watchedChanges(compare) {
  const files = (compare.files ?? []).filter((f) => WATCHED.includes(f.filename) || WATCHED.includes(f.previous_filename));
  return {
    latest: compare.commits?.at(-1)?.sha ?? compare.base_commit?.sha,
    files: files.map((f) => ({
      path: f.filename,
      status: f.status,
      url: f.blob_url,
      lines: (f.patch ?? "").split("\n").filter((l) => /^[-+](?![-+])/.test(l)).slice(0, 120),
    })),
  };
}

/**
 * The changed lines between two versions of a file, for when GitHub leaves a large patch out of a comparison.
 *
 * @param before - The file at the pinned commit
 * @param after - The file at the latest commit
 * @returns Removed lines as "-", added lines as "+", in file order, at most 120
 */
export function lineChanges(before, after) {
  const old = new Set(before.split("\n"));
  const now = new Set(after.split("\n"));
  const removed = before.split("\n").filter((l) => l.trim() && !now.has(l)).map((l) => `-${l}`);
  const added = after.split("\n").filter((l) => l.trim() && !old.has(l)).map((l) => `+${l}`);
  return [...removed, ...added].slice(0, 120);
}

/**
 * The change notice a person reviews.
 *
 * @param pin - The pinned source from the notes
 * @param changes - The result of watchedChanges
 * @returns Markdown: either "unchanged" or each changed file with its lines
 */
export function notice(pin, changes) {
  const head = `X ranking notes, checked ${pin.checked} at ${pin.repo}@${pin.commit.slice(0, 7)}. Latest: ${changes.latest?.slice(0, 7) ?? "unknown"}.`;
  if (!changes.files.length) return `${head}\n\nNo change in the files the notes rely on. Nothing to do.\n`;
  const body = changes.files.map((f) => `### ${f.path} (${f.status})\n${f.url}\n\n\`\`\`diff\n${f.lines.join("\n")}\n\`\`\``).join("\n\n");
  return `${head}\n\n${changes.files.length} file(s) the notes rely on changed. Read each change, check every number in ${NOTES} against the latest code, then update its Checked date and Source commit in one pull request. Until then the notes keep their date, and the skill stops using them 30 days after it.\n\n${body}\n`;
}

async function main() {
  const pin = pinned(readFileSync(NOTES, "utf8"));
  if (!pin) throw new Error(`${NOTES} has no Checked date or Source commit`);
  const headers = { Accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
  const api = `https://api.github.com/repos/${pin.repo}`;
  const repo = await fetch(api, { headers });
  if (!repo.ok) throw new Error(`GitHub answered ${repo.status} for ${pin.repo}`);
  const branch = (await repo.json()).default_branch;
  const res = await fetch(`${api}/compare/${process.argv[2] ?? pin.commit}...${branch}`, { headers });
  if (!res.ok) throw new Error(`GitHub compare answered ${res.status}`);
  const compare = await res.json();
  const changes = watchedChanges(compare);
  const raw = async (ref, path) => {
    const r = await fetch(`${api}/contents/${path}?ref=${ref}`, { headers: { ...headers, Accept: "application/vnd.github.raw" } });
    return r.ok ? r.text() : "";
  };
  for (const f of changes.files) {
    if (f.lines.length || f.status !== "modified") continue;
    f.lines = lineChanges(await raw(process.argv[2] ?? pin.commit, f.path), await raw(changes.latest, f.path));
  }
  process.stdout.write(notice({ ...pin, commit: process.argv[2] ?? pin.commit }, changes));
  process.exitCode = changes.files.length ? 2 : 0;
}

if (process.argv[1]?.endsWith("check-x-ranking.mjs")) await main();
