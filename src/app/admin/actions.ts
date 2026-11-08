"use server";

import { redirect } from "next/navigation";
import { claimAdminIfNone } from "@/lib/admin-role";
import { checkSetupCode } from "@/lib/admin-setup-code";
import { limit } from "@/lib/rate-limit";
import { adminAccess, signedInUserId } from "@/lib/current-user";
import { hasDatabase, postgresSettingsStore } from "@/lib/db";
import { SETTINGS, clearSetting, keepSavedSetting, saveSetting, type SettingKey } from "@/lib/settings";

function secrets() {
  const master = process.env.SETTINGS_KEY;
  if (!master) throw new Error("Admin is not configured on this deployment");
  return { master };
}

/**
 * A fresh deployment's first step: the signed-in person becomes its admin, only while it has none. In production the
 * claim always needs the server's ADMIN_SETUP_CODE (src/lib/admin-setup-code.ts), so a stranger who signs in first
 * cannot take the deployment, and neither can anyone after the last admin deletes their account. Without a usable
 * code nobody can claim from the web; the operator sets one, or runs `pnpm admin:grant` on the server.
 */
export async function claimAdmin(form: FormData) {
  const userId = await signedInUserId();
  if (!userId || !hasDatabase()) redirect("/admin");
  if (!(await limit("adminClaim", userId)).ok) redirect("/admin?problem=code");
  const code = checkSetupCode(String(form.get("code") ?? ""));
  if (code === "not-configured") redirect("/admin?problem=setup");
  if (code === "wrong") redirect("/admin?problem=code");
  await claimAdminIfNone(userId);
  redirect("/admin");
}

/**
 * Every admin action checks the signed-in person's role on the server; the page hiding a form is not the guard.
 *
 * @returns The admin's user id from the server session, recorded with each settings change
 */
async function requireAdmin(): Promise<string> {
  const userId = await signedInUserId();
  if (!userId || (await adminAccess()) !== "admin") redirect("/admin");
  return userId;
}

/** True only for the settings' own names, never for names every object inherits such as constructor. */
const isSettingKey = (key: string): key is SettingKey => Object.hasOwn(SETTINGS, key);

/** Saves one setting from its own field. */
export async function saveAdminSetting(form: FormData) {
  const by = await requireAdmin();
  const key = String(form.get("key")) as SettingKey;
  if (!isSettingKey(key)) redirect("/admin?error=key");
  if (!hasDatabase()) redirect("/admin?error=db");
  // A value saved here wins over the server's environment; removing it brings the environment's value back.
  const value = String(form.get("value") ?? "");
  let problem: string | null = null;
  try {
    await saveSetting(postgresSettingsStore(), key, value, secrets().master, by);
  } catch (e) {
    problem = e instanceof Error ? e.message : "could not be saved";
  }
  if (problem) redirect(`/admin?field=${key}&problem=${encodeURIComponent(problem)}`);
  redirect(`/admin?saved=${key}`);
}

/** Removes one saved setting, so the server's environment value (if any), else the default, applies again. */
export async function clearAdminSetting(form: FormData) {
  const by = await requireAdmin();
  const key = String(form.get("key")) as SettingKey;
  if (!isSettingKey(key) || !hasDatabase()) redirect("/admin");
  await clearSetting(postgresSettingsStore(), key, by);
  redirect(`/admin?cleared=${key}`);
}

/** Makes a value saved before v0.8 win over the server's environment, without typing it again. */
export async function keepAdminSetting(form: FormData) {
  const by = await requireAdmin();
  const key = String(form.get("key")) as SettingKey;
  if (!isSettingKey(key) || !hasDatabase()) redirect("/admin");
  await keepSavedSetting(postgresSettingsStore(), key, by);
  redirect(`/admin?kept=${key}`);
}


/** Explicit admin test: one native-caption request, never generated transcription. */
export async function testSupadataKey() {
  await requireAdmin();
  const userId = await signedInUserId();
  if (!userId || !(await limit("outbound", userId)).ok) return { message: "Too many tests. Try again shortly." };
  const { supadataKey } = await import("@/lib/env");
  const { fetchTranscript } = await import("@/lib/transcripts");
  const key = await supadataKey();
  if (!key) return { message: "Not set. Add a Supadata key first." };
  const r = await fetchTranscript("https://www.youtube.com/watch?v=dQw4w9WgXcQ", key);
  return { message: r.status === "ready" || r.status === "pending" ? "OK. Supadata accepted the key." : r.message };
}

/** Explicit admin test: one small search, which may use one Exa credit. */
export async function testExaKey() {
  await requireAdmin();
  const userId = await signedInUserId();
  if (!userId || !(await limit("outbound", userId)).ok) return { message: "Too many tests. Try again shortly." };
  const { exaKey } = await import("@/lib/env");
  const { searchWeb } = await import("@/lib/exa");
  const key = await exaKey();
  if (!key) return { message: "Not set. Add an Exa key first." };
  const r = await searchWeb({ query: "Queue Pilot", numResults: 1 }, key);
  return { message: r.status === "ready" ? "OK. Exa accepted the key." : r.message };
}
