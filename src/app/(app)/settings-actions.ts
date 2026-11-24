"use server";

import { revalidatePath } from "next/cache";
import { signedInUserId } from "@/lib/current-user";
import { postgresAiKeyStore, providerOf } from "@/lib/ai-key-store";
import { listModels, ModelListError } from "@/lib/ai-models";
import { APPROVE_MODES, setApproveMode } from "@/lib/agent-permission";
import { removeUnusedApps, renameApp, revokeApp } from "@/lib/ai-access";
import { MAX_LABEL } from "@/lib/ai-app-limits";
import { getAuth } from "@/lib/auth";
import { deleteAccount, LastAdminError } from "@/lib/delete-account";
import { clearSignInCookies } from "@/lib/sign-in-cookies";
import { cookies, headers } from "next/headers";
import { overLimit, tooMany } from "./action-limits";
import type { SourceActionResult } from "./actions";

/** Revokes one AI app's access to the signed-in user's Queue Pilot (approval and tokens). */
export async function revokeAiApp(consentId: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof consentId !== "string" || consentId.length > 200) return { ok: false, message: "Unknown app." };
  try {
    if (!(await revokeApp(userId, consentId))) return { ok: false, message: "That app is not connected to your account." };
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-revoke-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not revoke it just now. Try again in a minute." };
  }
  revalidatePath("/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Names one of the person's AI app connections so it can be told apart from another of the same app. */
export async function renameAiApp(consentId: string, label: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof consentId !== "string" || consentId.length > 200 || typeof label !== "string") return { ok: false, message: "Unknown app." };
  if (label.trim().length > MAX_LABEL) return { ok: false, message: `Keep the name under ${MAX_LABEL} characters.` };
  try {
    if (!(await renameApp(userId, consentId, label))) return { ok: false, message: "That app is not connected to your account." };
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-rename-app-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not save the name just now. Try again in a minute." };
  }
  revalidatePath("/settings");
  return { ok: true };
}

/** Removes every AI app connection that has gone unused long enough to stop working. */
export async function removeUnusedAiApps(): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  try {
    const removed = await removeUnusedApps(userId);
    revalidatePath("/settings");
    revalidatePath("/", "layout");
    return { ok: true, title: removed === 1 ? "Removed 1 unused connection." : `Removed ${removed} unused connections.` };
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-remove-unused-apps-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not remove them just now. Try again in a minute." };
  }
}

/** Signs this person out of Queue Pilot on every other browser; this one stays signed in. */
export async function signOutOtherDevices(): Promise<SourceActionResult> {
  { const l = await overLimit("account"); if (l) return tooMany(l); }
  if (!(await signedInUserId())) return { ok: false, message: "Sign in with Buffer first." };
  const auth = await getAuth();
  if (!auth) return { ok: false, message: "Queue Pilot is not open yet." };
  try {
    await auth.api.revokeOtherSessions({ headers: await headers() });
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-revoke-sessions-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not sign out the other browsers just now. Try again in a minute." };
  }
  revalidatePath("/settings");
  return { ok: true };
}

/** Deletes everything Queue Pilot stores for the signed-in person. The browser must send the word "delete". */
export async function deleteMyAccount(confirm: string): Promise<SourceActionResult> {
  { const l = await overLimit("account"); if (l) return tooMany(l); }
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  if (typeof confirm !== "string" || confirm.trim().toLowerCase() !== "delete") return { ok: false, message: "Type delete to confirm." };
  try {
    await deleteAccount(userId, process.env.SESSION_SECRET);
  } catch (e) {
    if (e instanceof LastAdminError) return { ok: false, message: e.message };
    console.error(JSON.stringify({ event: "qp-delete-account-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Queue Pilot could not delete your account just now. Nothing was removed. Try again in a minute." };
  }
  // The account and its sessions are gone, but this browser still holds the sign-in cookie. The router only checks
  // that the cookie exists, so clear it here or the person stays "signed in" to an empty app instead of the homepage.
  const jar = await cookies();
  clearSignInCookies(jar.getAll(), jar);
  return { ok: true };
}

const aiKeys = () => {
  const master = process.env.SETTINGS_KEY;
  return master ? postgresAiKeyStore(master) : null;
};

/** Saves the person's own AI key, encrypted; the provider is read from the key's prefix. */
export async function saveAiKey(input: string): Promise<SourceActionResult> {
  { const l = await overLimit("outbound"); if (l) return tooMany(l); }
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  const key = typeof input === "string" ? input.trim() : "";
  const provider = providerOf(key);
  if (!provider) return { ok: false, message: "That does not look like an Anthropic key (sk-ant-…), an OpenAI key (sk-…) or an OpenRouter key (sk-or-v1-…)." };
  const store = aiKeys();
  if (!store) return { ok: false, message: "This copy of Queue Pilot cannot store keys yet (SETTINGS_KEY is not set)." };
  // Listing the key's models checks the key works and gives the default model, before anything is stored.
  let list;
  try {
    list = await listModels(provider, key);
  } catch (e) {
    return { ok: false, message: e instanceof ModelListError ? e.message : "Could not check the key just now. Try again." };
  }
  if (!list.recommended) return { ok: false, message: "This key cannot use any text model." };
  try {
    await store.set(userId, provider, key, list.recommended);
  } catch (e) {
    console.error(JSON.stringify({ event: "qp-ai-key-save-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "Could not save the key just now. Try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}

export async function removeAiKey(): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  const store = aiKeys();
  if (!userId || !store) return { ok: false, message: "Sign in with Buffer first." };
  await store.remove(userId).catch(() => {});
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Settings → AI: whether connected apps may approve drafts, and whether they must ask first. Only this screen sets it. */
export async function setAgentApproveMode(mode: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  if (!userId) return { ok: false, message: "Sign in with Buffer first." };
  const chosen = APPROVE_MODES.find((m) => m === mode);
  if (!chosen) return { ok: false, message: "Unknown choice." };
  try { await setApproveMode(userId, chosen); }
  catch (e) {
    console.error(JSON.stringify({ event: "qp-approve-mode-failed", message: e instanceof Error ? e.message : String(e) }));
    return { ok: false, message: "That didn't save. Try again." };
  }
  revalidatePath("/settings");
  return { ok: true };
}

/** Changes the model for the saved key, after checking the provider still lists it for this key. */
export async function setAiModel(model: string): Promise<SourceActionResult> {
  const userId = await signedInUserId();
  const store = aiKeys();
  if (!userId || !store) return { ok: false, message: "Sign in with Buffer first." };
  const cfg = await store.get(userId).catch(() => null);
  if (!cfg) return { ok: false, message: "Add your AI key first." };
  try {
    const list = await listModels(cfg.provider, cfg.key);
    if (!list.models.some((m) => m.id === model)) return { ok: false, message: "That model is not available to this key." };
    await store.setModel(userId, model);
  } catch (e) {
    return { ok: false, message: e instanceof ModelListError ? e.message : "Could not change the model just now. Try again." };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
