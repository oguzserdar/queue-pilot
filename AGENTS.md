<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Working on Queue Pilot

- Checks: `pnpm test` (run with `--maxWorkers=2` on a small machine) and `pnpm typecheck`. `bash scripts/check-overflow.sh` checks every screen at 671 and 1440 pixels wide.
- Buffer allows about 100 requests per 15 minutes. Screens and connector tools read the saved copy of the account (`src/lib/buffer/snapshot.ts`), never Buffer directly. A new screen does the same.
- Queue Pilot changes or deletes only drafts it made (`via: api`). Keep that guard in `src/lib/edit-drafts.ts` and its test.
- Signed out, every screen shows the example account and says so. Never show example data as a real account's.
- What we learned about Buffer's API, with sources: `docs/buffer-api-notes.md`.
