/**
 * Runs once when a server starts. Logs which settings have a value saved in /admin that hides the server's
 * environment value, and which values saved before v0.8 the environment's value still holds back (names only). Does not hold up start: the check runs in the background and a failure is only logged.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { hasDatabase, postgresSettingsStore } = await import("./lib/db");
  if (!hasDatabase()) return;
  const { logShadowedSettings } = await import("./lib/settings");
  void logShadowedSettings(postgresSettingsStore()).catch((e) => {
    console.error(JSON.stringify({ event: "qp-setting-shadows-check-failed", message: e instanceof Error ? e.message : String(e) }));
  });
}
