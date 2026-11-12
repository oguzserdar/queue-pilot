# Contributing

Thanks for helping. Queue Pilot is a Next.js app on the Buffer API, MIT licensed.

## Run it

1. Copy `.env.example` to `.env` and fill it in.
2. With Node 24 and pnpm 10, run `pnpm install`. Set `DATABASE_URL` in `.env` to a Postgres you can reach from your machine, then run `pnpm db:migrate` to create the tables, and `pnpm dev`. Or run everything, database included, with `docker compose up`, which applies migrations when the app starts.

## Before a pull request

`pnpm install` also sets up the git hooks. Each commit runs the typecheck, the copy rules and the gate tests on what
you staged, and checks the message format. Each push runs the full test suite.

- `pnpm typecheck` and `pnpm test` pass. Tests run Postgres in-process (PGLite), so no database is needed.
- A bug fix starts with a test that fails without the fix.
- Add a line under Unreleased in `CHANGELOG.md`, written for the people who use Queue Pilot.
- The pull request title follows Conventional Commits: `feat: ...`, `fix: ...`, `docs: ...`. It becomes the commit
  message on main.
- `pnpm check:copy` passes. It checks README, CHANGELOG, ROADMAP and CONTRIBUTING.

## Three rules the code keeps

- Queue Pilot never schedules or publishes on its own. Only your Approve schedules, or your AI when you ask it.
- Queue Pilot approves, changes or deletes only drafts it wrote.
- Every Buffer request counts against a shared daily limit, so a change never adds requests to an action without a
  reason in the pull request.

## Releases

A release is cut with `pnpm release X.Y.Z "Name"` and published with `git push --follow-tags`. CI then publishes the
GitHub Release from the changelog and the Docker image to GHCR. The plan is in `ROADMAP.md`.
