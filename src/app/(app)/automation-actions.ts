"use server";
/**
 * Settings actions for reply automations: save one (new or changed) and delete one. Each acts only for the signed-in
 * person; the store checks the input and that the account and automation are theirs.
 */
import { revalidatePath } from "next/cache";
import { signedInUserId } from "@/lib/current-user";
import { deleteAutomation, saveAutomation } from "@/lib/reply-automation-store";

type Result = { ok: boolean; message: string; id?: string };
const signedOut: Result = { ok: false, message: "Sign in with Buffer first." };

/** Saves a reply automation for the signed-in person. */
export async function saveAutomationAction(input: unknown): Promise<Result> {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  const r = await saveAutomation(userId, input);
  if (!r.ok) return { ok: false, message: r.error === "not-found" ? "That account or automation is no longer there. Reload the page." : r.message ?? "Check the automation and try again." };
  revalidatePath("/settings");
  return { ok: true, message: "Automation saved.", id: r.id };
}

/** Deletes one of the signed-in person's reply automations. */
export async function deleteAutomationAction(id: string): Promise<Result> {
  const userId = await signedInUserId();
  if (!userId) return signedOut;
  if (!(await deleteAutomation(userId, id))) return { ok: false, message: "That automation is no longer there. Reload the page." };
  revalidatePath("/settings");
  return { ok: true, message: "Automation deleted." };
}
