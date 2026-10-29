/**
 * @fileoverview Start-up check for the settings a server needs before it can run.
 *
 * Called once by scripts/migrate-on-deploy.mjs before migrations. Each problem names the variable and the command
 * that fixes it, so a self-hoster never has to read the source. Plain JavaScript so the start script can import it
 * without a build step.
 */
/**
 * Lists every missing or malformed start-up setting.
 *
 * @param {Record<string, string | undefined>} [env] - Environment to check; defaults to `process.env`
 * @returns {string[]} One sentence per problem, empty when the setup is complete
 */
export function envProblems(env = process.env) {
  const problems = [];
  if (!env.DATABASE_URL) problems.push("DATABASE_URL is not set. Point it at your Postgres database.");
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 32) problems.push("SESSION_SECRET must be 32 characters or more. Generate one: openssl rand -hex 32");
  if (!/^[0-9a-f]{64}$/i.test(env.SETTINGS_KEY ?? "")) problems.push("SETTINGS_KEY must be 64 hex characters. Generate one: openssl rand -hex 32");
  return problems;
}
