"use server";

import { createHash, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { claimAdminIfNone } from "@/lib/admin-role";
import { limit } from "@/lib/rate-limit";
import { adminAccess, signedInUserId } from "@/lib/current-user";
import { hasDatabase, postgresSettingsStore } from "@/lib/db";
import { SETTINGS, clearSetting, saveSetting, type SettingKey } from "@/lib/settings";

function secrets() {
  const master = process.env.SETTINGS_KEY;
  if (!master) throw new Error("Admin is not configured on this deployment");
  return { master };
}

/**
 * A fresh deployment's first step: the signed-in person becomes its admin, only while it has none. When the server
 * sets ADMIN_SETUP_CODE, the claim also needs that code, so a stranger who signs in first cannot take the deployment,
 * and neither can anyone after the last admin deletes their account.
 */
export async function claimAdmin(form: FormData) {
  const userId = await signedInUserId();
  if (!userId || !hasDatabase()) redirect("/admin");
  if (!(await limit("adminClaim", userId)).ok) redirect("/admin?problem=code");
  if (!setupCodeMatches(String(form.get("code") ?? ""))) redirect("/admin?problem=code");
  await claimAdminIfNone(userId);
  redirect("/admin");
}

/**
 * True when no setup code is configured, or the typed one matches it (compared in constant time). A configured code
 * shorter than 24 characters is too easy to guess, so it never matches.
 */
function setupCodeMatches(typed: string): boolean {
  const expected = process.env.ADMIN_SETUP_CODE?.trim();
  if (!expected) return true;
  if (expected.length < 24) return false;
  const a = createHash("sha256").update(typed.trim()).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Every admin action checks the signed-in person's role on the server; the page hiding a form is not the guard. */
async function requireAdmin() {
  if ((await adminAccess()) !== "admin") redirect("/admin");
}

/** Saves one setting from its own field. */
export async function saveAdminSetting(form: FormData) {
  await requireAdmin();
  const key = String(form.get("key")) as SettingKey;
  if (!(key in SETTINGS)) redirect("/admin?error=key");
  if (!hasDatabase()) redirect("/admin?error=db");
  // The server's environment pins a setting; /admin shows it read-only and never overrides it.
  if (process.env[SETTINGS[key].env]?.trim()) redirect(`/admin?error=pinned&field=${key}`);
  const value = String(form.get("value") ?? "");
  let problem: string | null = null;
  try {
    await saveSetting(postgresSettingsStore(), key, value, secrets().master);
  } catch (e) {
    problem = e instanceof Error ? e.message : "could not be saved";
  }
  if (problem) redirect(`/admin?field=${key}&problem=${encodeURIComponent(problem)}`);
  redirect(`/admin?saved=${key}`);
}

/** Removes one saved setting, so the environment value (if any) applies again. */
export async function clearAdminSetting(form: FormData) {
  await requireAdmin();
  const key = String(form.get("key")) as SettingKey;
  if (!(key in SETTINGS) || !hasDatabase()) redirect("/admin");
  await clearSetting(postgresSettingsStore(), key);
  redirect(`/admin?cleared=${key}`);
}

