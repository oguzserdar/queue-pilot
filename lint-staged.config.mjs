/**
 * Checks run on every commit, against what is staged. Each check that reads the whole project runs once, not once
 * per file. The full test suite runs on push (.husky/pre-push) and again in CI.
 */
const DOCS = ["README.md", "CHANGELOG.md", "ROADMAP.md", "CONTRIBUTING.md"];

export default {
  "*.{ts,tsx,mjs}": () => ["pnpm typecheck", "pnpm check:gates"],
  "*.{css,md}": () => "pnpm check:gates",
  "*.md": (files) => {
    const docs = files.filter((f) => DOCS.some((d) => f.endsWith(`/${d}`)));
    return docs.length ? `python3 scripts/copy-gate.py ${docs.join(" ")}` : [];
  },
};
