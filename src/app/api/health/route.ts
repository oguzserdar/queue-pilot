/** Liveness for container hosts (Docker HEALTHCHECK, Coolify, Railway, Render). Answers without touching the database or Buffer. */
export const dynamic = "force-dynamic";

import pkg from "../../../../package.json";

/** Liveness: the running version and commit, without touching the database, so a slow database never restarts a healthy container. */
export function GET(): Response {
  const commit = process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.SOURCE_COMMIT ?? null;
  return Response.json({ ok: true, version: pkg.version, commit: commit ? commit.slice(0, 12) : null }, { headers: { "cache-control": "no-store" } });
}
