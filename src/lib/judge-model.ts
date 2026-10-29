/**
 * The AI a person's actions run on: their own saved key first, then Queue Pilot's built-in key from /admin while the
 * operator's dollar budget and the person's daily allowance last (src/lib/ai-allowance.ts), else none. Actions on the
 * built-in key are metered (src/lib/ai-meter.ts) and their cost recorded when they finish. Which model the built-in key
 * uses comes from the provider's own list, cached per process for an hour as a promise so parallel saves share one
 * lookup.
 */
import { postgresAiKeyStore, providerOf } from "./ai-key-store";
import { listModels } from "./ai-models";
import { decisionModelFor, modelFor, type AiConfig } from "./ai-model";
import type { Judges } from "./judge";
import { hasDatabase, postgresSettingsStore } from "./db";
import { resolveSetting } from "./settings";
import { NO_DAILY_TOTAL, capMessage, postgresAllowanceStore, utcDay, type Caps } from "./ai-allowance";
import { meter, priceFor } from "./ai-meter";
import type { Experimental_DecisionModel as DecisionModel, LanguageModel } from "ai";

/** Thrown when the built-in key's daily allowance is used up; the message is written for the person. */
export class AiCapError extends Error {}

/**
 * One action's AI: the models to call (metered on the built-in key), then settle() once when the action is over to
 * record its cost, or giveBack() when its AI call failed.
 */
export type Ai = {
  cfg: AiConfig;
  source: "your key" | "Queue Pilot's key";
  language: LanguageModel;
  decider: DecisionModel | null;
  settle: () => Promise<void>;
  giveBack: () => Promise<void>;
};

export type JudgeModel = { judges: Judges } & Ai;

const HOUR = 3600_000;
const recommended = new Map<string, { promise: Promise<string | null>; expires: number }>();

function recommendedFor(cfg: Omit<AiConfig, "model">): Promise<string | null> {
  const hit = recommended.get(cfg.key);
  if (hit && hit.expires > Date.now()) return hit.promise;
  const promise = listModels(cfg.provider, cfg.key).then((l) => l.recommended);
  recommended.set(cfg.key, { promise, expires: Date.now() + HOUR });
  promise.catch(() => { if (recommended.get(cfg.key)?.promise === promise) recommended.delete(cfg.key); });
  return promise;
}

/** The caps from /admin, the environment or the registry's defaults (src/lib/settings.ts). */
async function caps(master: string): Promise<Caps> {
  const read = async (key: "ai_cap_per_person" | "ai_cap_total") => {
    const v = await resolveSetting(postgresSettingsStore(), key, master).catch(() => null);
    const n = v ? Number.parseInt(v.value, 10) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : null;
  };
  return { perPerson: (await read("ai_cap_per_person")) ?? 0, total: (await read("ai_cap_total")) ?? NO_DAILY_TOTAL };
}

/** The operator's total budget for the built-in key in millionths of a dollar; 0 when none is set (the key is off). */
async function budgetMicros(master: string): Promise<number> {
  const v = await resolveSetting(postgresSettingsStore(), "ai_budget_usd", master).catch(() => null);
  const usd = v ? Number.parseFloat(v.value) : NaN;
  return Number.isFinite(usd) && usd > 0 ? Math.round(usd * 1_000_000) : 0;
}

/**
 * The AI for one action by this person. Own key: no limit. Built-in key: only while a budget is set and not spent,
 * and the person has actions left today (AiCapError otherwise). Null when there is no usable key at all.
 * A person with their own key never falls back to the built-in key, even when their model list cannot be read.
 * `ownKeyOnly` is for things the person did not ask for, such as a live preview, which must not spend the built-in key.
 */
export async function aiFor(userId: string, now: Date = new Date(), opts: { ownKeyOnly?: boolean } = {}): Promise<Ai | null> {
  const master = process.env.SETTINGS_KEY;
  if (!master || !hasDatabase()) return null;
  const own = await postgresAiKeyStore(master).get(userId).catch(() => null);
  if (own) {
    const model = own.model ?? (await recommendedFor(own).catch(() => null));
    if (model) {
      const cfg = { ...own, model };
      return { cfg, source: "your key", language: modelFor(cfg), decider: decisionModelFor(cfg), settle: async () => {}, giveBack: async () => {} };
    }
    return null;
  }
  if (opts.ownKeyOnly) return null;
  const fallback = await resolveSetting(postgresSettingsStore(), "fallback_ai_key", master).catch(() => null);
  const provider = fallback ? providerOf(fallback.value) : null;
  if (!fallback || !provider) return null;
  const budget = await budgetMicros(master);
  if (!budget) return null;
  const model = await recommendedFor({ provider, key: fallback.value }).catch(() => null);
  if (!model) return null;
  const price = await priceFor(provider, model).catch(() => null);
  if (!price) {
    console.error(JSON.stringify({ event: "qp-builtin-ai-no-price", provider, model }));
    return null;
  }
  const store = postgresAllowanceStore();
  if ((await store.spentMicros()) >= budget) throw new AiCapError("This deployment's built-in AI is used up for now. Add your own key in Settings to keep going.");
  const limits = await caps(master);
  const day = utcDay(now);
  const taken = await store.take(userId, day, limits);
  if (taken !== "ok") throw new AiCapError(capMessage(taken, limits));
  const cfg = { provider, key: fallback.value, model };
  const m = meter(price);
  let settled = false;
  return {
    cfg,
    source: "Queue Pilot's key",
    language: m.language(modelFor(cfg)),
    decider: m.decider(decisionModelFor(cfg)),
    // Recorded once, after the action, so every model call it made is counted together.
    settle: async () => { if (!settled) { settled = true; await store.addCost(userId, day, m.spent()).catch(() => {}); } },
    giveBack: async () => { await store.giveBack(userId, day).catch(() => {}); },
  };
}

/** The decide and explain models for one action by this person; see aiFor for which key and limits apply. */
export async function judgeModelFor(userId: string, opts: { ownKeyOnly?: boolean } = {}): Promise<JudgeModel | null> {
  const ai = await aiFor(userId, new Date(), opts);
  return ai ? { ...ai, judges: { decider: ai.decider, explainer: ai.language } } : null;
}

/**
 * Today's use of the built-in key for this person and what is left of the shared budget, for Settings. Null when
 * this copy has no built-in key or no budget, since the key is then off.
 */
export async function allowanceFor(userId: string, now: Date = new Date()): Promise<{ used: number; cap: number; budgetUsd: number; leftUsd: number } | null> {
  const master = process.env.SETTINGS_KEY;
  if (!master || !hasDatabase()) return null;
  const fallback = await resolveSetting(postgresSettingsStore(), "fallback_ai_key", master).catch(() => null);
  if (!fallback || !providerOf(fallback.value)) return null;
  const budget = await budgetMicros(master);
  if (!budget) return null;
  const store = postgresAllowanceStore();
  const [limits, used, spent] = await Promise.all([caps(master), store.used(userId, utcDay(now)), store.spentMicros()]);
  return { used: used.mine, cap: limits.perPerson, budgetUsd: budget / 1_000_000, leftUsd: Math.max(0, budget - spent) / 1_000_000 };
}
