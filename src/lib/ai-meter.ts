/**
 * What an AI action on Queue Pilot's built-in key cost, in micro-dollars (millionths of a US dollar), from the tokens
 * the provider reports and per-token prices from a public, maintained price list (PRICE_LIST_URL), keyed by the same
 * model ids our keys use.
 * The list is read at most once a day per process. A model with no listed price cannot run on the built-in key, so
 * spending is never counted at zero by mistake.
 */
import { wrapLanguageModel, type Experimental_DecisionModel as DecisionModel, type LanguageModel } from "ai";
import type { Experimental_DecisionModelV4 } from "@ai-sdk/provider";
import type { Provider } from "./ai-key-store";

/** Where per-token prices are read from. */
export const PRICE_LIST_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
const DAY_MS = 86_400_000;

/** US dollars per token. */
export type Price = { input: number; output: number };
type PriceList = Record<string, { input_cost_per_token?: number; output_cost_per_token?: number }>;

/** The price list key for a model: LiteLLM keys OpenRouter models as "openrouter/<id>". */
export const priceKey = (provider: Provider, model: string) => (provider === "openrouter" ? `openrouter/${model}` : model);

/** The price of one model from a price list, or null when it is not listed with both prices. */
export function priceIn(list: PriceList, provider: Provider, model: string): Price | null {
  const row = list[priceKey(provider, model)];
  const input = row?.input_cost_per_token;
  const output = row?.output_cost_per_token;
  return typeof input === "number" && typeof output === "number" ? { input, output } : null;
}

let cached: { promise: Promise<PriceList>; expires: number } | null = null;

/** The model's price, read from the shared list (cached as a promise for a day; a failed read is not kept). */
export async function priceFor(provider: Provider, model: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<Price | null> {
  if (!cached || cached.expires <= now) {
    const promise = fetchImpl(PRICE_LIST_URL, { signal: AbortSignal.timeout(15_000) }).then(async (r) => {
      if (!r.ok) throw new Error(`price list answered ${r.status}`);
      return (await r.json()) as PriceList;
    });
    cached = { promise, expires: now + DAY_MS };
    promise.catch(() => { if (cached?.promise === promise) cached = null; });
  }
  return priceIn(await cached.promise, provider, model);
}

/** Forgets the cached price list (tests). */
export const resetPriceCache = () => { cached = null; };

/** Micro-dollars for a number of tokens at a price. */
export const costMicros = (price: Price, inputTokens: number, outputTokens: number) =>
  Math.round((inputTokens * price.input + outputTokens * price.output) * 1_000_000);

/**
 * Counts the tokens of every call made through the models it wraps, so one action's cost can be recorded once at the
 * end, whatever number of calls it took.
 */
export function meter(price: Price) {
  let input = 0;
  let output = 0;
  return {
    language(model: LanguageModel): LanguageModel {
      return wrapLanguageModel({
        model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
        middleware: {
          specificationVersion: "v4",
          wrapGenerate: async ({ doGenerate }) => {
            const r = await doGenerate();
            input += r.usage.inputTokens.total ?? 0;
            output += r.usage.outputTokens.total ?? 0;
            return r;
          },
        },
      });
    },
    decider(model: DecisionModel | null): DecisionModel | null {
      if (!model || typeof model === "string" || !("doDecide" in model)) return model;
      const inner = model as Experimental_DecisionModelV4;
      return {
        ...inner,
        doDecide: async (options) => {
          const r = await inner.doDecide(options);
          input += r.usage?.inputTokens ?? 0;
          output += r.usage?.outputTokens ?? 0;
          return r;
        },
      };
    },
    /** Micro-dollars spent through these models so far. */
    spent: () => costMicros(price, input, output),
  };
}
