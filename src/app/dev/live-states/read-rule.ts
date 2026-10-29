"use server";
/**
 * Development only: reads a rule with the eval key from .env.eval.local, so the rule box's live reading can be timed in
 * a browser without a Buffer sign-in. Production answers null.
 */
import { providerOf } from "@/lib/ai-key-store";
import { modelFor } from "@/lib/ai-model";
import { parseNewRule, type NewRule } from "@/lib/rules";
import { structureRule } from "@/lib/structure-rule";

export async function devReadRule(text: string): Promise<NewRule | null> {
  if (process.env.NODE_ENV === "production") return null;
  try {
    process.loadEnvFile(".env.eval.local");
  } catch {}
  const key = process.env.QP_EVAL_KEY ?? "";
  const provider = providerOf(key);
  if (!provider || !process.env.QP_EVAL_MODEL) return null;
  const parsed = parseNewRule({ kind: "guidance", text, channels: "all", level: "warn" });
  if (typeof parsed === "string") return null;
  return structureRule(modelFor({ provider, key, model: process.env.QP_EVAL_MODEL }), parsed);
}
