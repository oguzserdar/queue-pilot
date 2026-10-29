/**
 * AI SDK v7 model instances for the person's own key (createAnthropic / createOpenAI
 * per call, the key passed in, never read from the environment). Writers and the judge take a LanguageModel, so tests
 * pass the SDK's mock model instead of calling a provider.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { APICallError, Experimental_DecisionRefusalError, NoObjectGeneratedError, type Experimental_DecisionModel as DecisionModel, type LanguageModel } from "ai";
import type { Provider } from "./ai-key-store";

export type AiConfig = { provider: Provider; key: string; model: string };

/** OpenRouter's own AI SDK provider, the one the AI SDK docs list for it. */
const openRouter = (key: string) => createOpenRouter({ apiKey: key, headers: { "X-Title": "Queue Pilot" } });

/** The language model for a provider, key and model id. */
export function modelFor(cfg: AiConfig): LanguageModel {
  if (cfg.provider === "openrouter") return openRouter(cfg.key).chat(cfg.model);
  return cfg.provider === "anthropic" ? createAnthropic({ apiKey: cfg.key })(cfg.model) : createOpenAI({ apiKey: cfg.key })(cfg.model);
}

/** OpenAI's decision models are their own ids; the provider types name gpt-6-luna. */
export const OPENAI_DECISION_MODEL = "gpt-6-luna";

/**
 * The decision model for playbook verdicts (experimental_decide). Anthropic runs decisions through its Messages API,
 * so the person's chosen Claude model judges; OpenAI judges with its decision model. OpenRouter has none (null).
 */
export function decisionModelFor(cfg: AiConfig): DecisionModel | null {
  // OpenRouter's evaluationModel() runs on its alpha Decisions API, so verdicts come from the language model's
  // structured output instead (judge.ts), which every model Queue Pilot offers supports.
  if (cfg.provider === "openrouter") return null;
  return cfg.provider === "anthropic" ? createAnthropic({ apiKey: cfg.key }).decisionModel(cfg.model) : createOpenAI({ apiKey: cfg.key }).decisionModel(OPENAI_DECISION_MODEL);
}

/** An error written for the person; never contains the key. */
export class AiError extends Error {}

/** Turns an AI SDK error into a sentence for the person. Provider bodies are trimmed and any key-like text removed. */
export function aiErrorMessage(e: unknown, provider: Provider): string {
  const name = provider === "anthropic" ? "Anthropic" : provider === "openrouter" ? "OpenRouter" : "OpenAI";
  if (APICallError.isInstance(e)) {
    if (e.statusCode === 401 || e.statusCode === 403) return `${name} refused the key. Check it in Settings.`;
    if (e.statusCode === 429) return `${name} said the key is over its limit or out of credit. Try again later.`;
    if (e.statusCode === 404) return `${name} does not offer that model to this key. Pick another in Settings.`;
    return `${name} could not answer (${e.statusCode ?? "no response"}${e.message ? `: ${e.message.replace(/sk-[\w-]+/g, "[key]").slice(0, 200)}` : ""}).`;
  }
  if (NoObjectGeneratedError.isInstance(e)) return `${name} answered, but not in the form Queue Pilot asked for. Try again.`;
  if (e instanceof Experimental_DecisionRefusalError) return `${name} declined to judge this draft.`;
  return `Could not reach ${name} just now. Try again.`;
}
