"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import * as z from "zod";
import { claimAdminIfNone } from "@/lib/admin-role";
import { checkSetupCode } from "@/lib/admin-setup-code";
import { limit } from "@/lib/rate-limit";
import { signedInUserId } from "@/lib/current-user";
import { hasDatabase } from "@/lib/db";
import { invokeAdminOperation, type AdminOperationName, type AdminOutcome } from "@/lib/admin-operations";

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
  const code = checkSetupCode(formText(form, "code"));
  if (code === "not-configured") redirect("/admin?problem=setup");
  if (code === "wrong") redirect("/admin?problem=code");
  await claimAdminIfNone(userId);
  redirect("/admin");
}

/** A text field of the posted form; a missing field (or a file) reads as empty. */
function formText(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value : "";
}

const withMessage = z.object({ message: z.string() });

/** The message the settings and key-test operations answer with; any other answer is a bug in the operation. */
function valueMessage(value: unknown): string {
  const parsed = withMessage.safeParse(value);
  if (!parsed.success) throw new Error("The admin operation answered without a message.");
  return parsed.data.message;
}

/**
 * Runs one admin operation through the door as the signed-in person. The door checks the role, limits, records and
 * runs; a signed-out person or someone who is not the admin is sent back to /admin, as before.
 */
async function run(name: AdminOperationName, input: Record<string, unknown>): Promise<AdminOutcome> {
  const userId = await signedInUserId();
  if (!userId) redirect("/admin");
  const outcome = await invokeAdminOperation({ via: "page", userId }, name, input);
  if (!outcome.ok && outcome.code === "PERMISSION_DENIED") redirect("/admin");
  return outcome;
}

/** What a settings change did, said in plain words for the toast or the alert next to the field. */
export type AdminResult = { ok: boolean; message: string };

/** The page's answer for one settings operation: its own message on success, the door's message otherwise. */
function settingResult(outcome: AdminOutcome): AdminResult {
  if (!outcome.ok) return { ok: false, message: outcome.message };
  revalidatePath("/admin");
  return { ok: true, message: valueMessage(outcome.value) };
}

/**
 * Saves one setting from its own field. Returns what happened instead of redirecting, so the page stays on the same
 * tab and the person sees the result where they are. A value saved here wins over the server's environment; removing
 * it brings the environment's value back.
 */
export async function saveAdminSetting(_prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  return settingResult(await run("admin.settings.set", { key: formText(form, "key"), value: formText(form, "value") }));
}

/** Removes one saved setting, so the server's environment value (if any), else the default, applies again. */
export async function clearAdminSetting(_prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  // The Remove button is the admin's confirmation; the page has no reason field, so it records where it came from.
  return settingResult(await run("admin.settings.clear", { key: formText(form, "key"), confirm: true, reason: "Removed on the admin page." }));
}

/** Makes a value saved before v0.8 win over the server's environment, without typing it again. */
export async function keepAdminSetting(_prev: AdminResult | null, form: FormData): Promise<AdminResult> {
  return settingResult(await run("admin.settings.keep", { key: formText(form, "key") }));
}

/** The answer of one key test, in the page's words. */
async function keyTest(service: "supadata" | "exa"): Promise<{ message: string }> {
  const outcome = await run("admin.keys.test", { service });
  return { message: outcome.ok ? valueMessage(outcome.value) : outcome.message };
}

/** Explicit admin test: one native-caption request, never generated transcription. */
export async function testSupadataKey() {
  return keyTest("supadata");
}

/** Explicit admin test: one small search, which may use one Exa credit. */
export async function testExaKey() {
  return keyTest("exa");
}

/** Gives or takes one connected app's admin access, for the control under Settings, Connected AI apps. */
async function appAdminAccess(name: "admin.apps.grant" | "admin.apps.revoke", consentId: string): Promise<AdminResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof consentId !== "string") return { ok: false, message: "Unknown app." };
  const outcome = await invokeAdminOperation({ via: "page", userId }, name, { consentId });
  if (!outcome.ok) return { ok: false, message: outcome.message };
  revalidatePath("/settings");
  return { ok: true, message: name === "admin.apps.grant" ? "This app can now run admin actions for you." : "This app can no longer run admin actions." };
}

/**
 * Lets one of the admin's connected AI apps run admin operations. A normal connection never can: the app needs this
 * grant as well as the person's admin role, both checked on every call.
 */
export async function grantAppAdminAccess(consentId: string): Promise<AdminResult> {
  return appAdminAccess("admin.apps.grant", consentId);
}

/** Takes admin access from one connected AI app; it keeps its normal access. */
export async function removeAppAdminAccess(consentId: string): Promise<AdminResult> {
  return appAdminAccess("admin.apps.revoke", consentId);
}
