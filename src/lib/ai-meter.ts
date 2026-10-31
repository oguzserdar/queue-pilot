/**
 * What an AI action on Queue Pilot's built-in key cost, in micro-dollars (millionths of a US dollar).
 * OpenRouter reports what it billed for each call, and that amount is counted. Other calls are priced from the tokens
 * the provider reports: OpenRouter models from OpenRouter's own models list (OPENROUTER_PRICES_URL), Anthropic and
 * OpenAI models from a public, maintained machine-readable list (PRICE_LIST_URL), since those two publish prices only
 * as web pages. Cache reads and cache writes are priced at their own rates. Each list is read at most once a day.
 * A model with no usable listed price cannot run on the built-in key, so spending is never counted at zero by mistake.
 */
import { wrapLanguageModel, type Experimental_DecisionModel as DecisionModel, type LanguageModel } from "ai";
import type { Experimental_DecisionModelV4 } from "@ai-sdk/provider";
import type { Provider } from "./ai-key-store";

/** Where Anthropic and OpenAI per-token prices are read from. */
export const PRICE_LIST_URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json";
/** OpenRouter's own models list, with each model's per-token prices. */
export const OPENROUTER_PRICES_URL = "https://openrouter.ai/api/v1/models";
const DAY_MS = 86_400_000;

/** US dollars per token: plain input, output, and input read from or written to the prompt cache. */
export type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };
type PriceList = Record<string, { input_cost_per_token?: unknown; output_cost_per_token?: unknown; cache_read_input_token_cost?: unknown; cache_creation_input_token_cost?: unknown }>;
type OpenRouterRates = { prompt?: unknown; completion?: unknown; input_cache_read?: unknown; input_cache_write?: unknown };
type OpenRouterPrices = { data?: { id: string; pricing?: OpenRouterRates & { overrides?: OpenRouterRates[] } }[] };

/** A listed rate as a number, or NaN when it is missing, not a number, infinite or negative. */
function rate(v: unknown): number {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : NaN;
  return Number.isFinite(n) && n >= 0 ? n : NaN;
}

/**
 * A price from listed rates, or null when the input or output rate is unusable, so the model cannot run on the
 * built-in key. An unusable or missing cache rate is charged the plain input rate, never less.
 */
function priceFrom(input: unknown, output: unknown, cacheRead: unknown, cacheWrite: unknown): Price | null {
  const i = rate(input);
  const o = rate(output);
  if (Number.isNaN(i) || Number.isNaN(o)) return null;
  const or = (v: unknown) => (Number.isNaN(rate(v)) ? i : rate(v));
  return { input: i, output: o, cacheRead: or(cacheRead), cacheWrite: or(cacheWrite) };
}

/** The price of one Anthropic or OpenAI model from the price list, or null when it is not usably listed. */
export function priceIn(list: PriceList, model: string): Price | null {
  const row = list[model];
  return row ? priceFrom(row.input_cost_per_token, row.output_cost_per_token, row.cache_read_input_token_cost, row.cache_creation_input_token_cost) : null;
}

/**
 * The price of one OpenRouter model from OpenRouter's own list, or null when it is not usably listed. OpenRouter
 * raises some rates under conditions (long prompts, time windows) in `overrides`. Which one applies is only known
 * after the call, so each rate is the highest of the base and every override: an estimate never below the bill.
 * The meter prefers the cost OpenRouter reports for the call itself.
 */
export function openRouterPriceIn(list: OpenRouterPrices, model: string): Price | null {
  const p = list.data?.find((m) => m.id === model)?.pricing;
  if (!p) return null;
  const tiers = [p, ...(p.overrides ?? []).map((o) => ({ ...p, ...o }))].map((t) => priceFrom(t.prompt, t.completion, t.input_cache_read, t.input_cache_write));
  if (tiers.some((t) => t === null)) return null;
  const all = tiers as Price[];
  const max = (k: keyof Price) => Math.max(...all.map((t) => t[k]));
  return { input: max("input"), output: max("output"), cacheRead: max("cacheRead"), cacheWrite: max("cacheWrite") };
}

const cached = new Map<string, { promise: Promise<unknown>; expires: number }>();

/** One list, cached as a promise for a day; a failed read is not kept. */
function readList(url: string, fetchImpl: typeof fetch, now: number): Promise<unknown> {
  const hit = cached.get(url);
  if (hit && hit.expires > now) return hit.promise;
  const promise = fetchImpl(url, { signal: AbortSignal.timeout(15_000) }).then(async (r) => {
    if (!r.ok) throw new Error(`price list answered ${r.status}`);
    return r.json() as Promise<unknown>;
  });
  cached.set(url, { promise, expires: now + DAY_MS });
  promise.catch(() => { if (cached.get(url)?.promise === promise) cached.delete(url); });
  return promise;
}

/** The model's price from the list that covers its provider. */
export async function priceFor(provider: Provider, model: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<Price | null> {
  return provider === "openrouter"
    ? openRouterPriceIn((await readList(OPENROUTER_PRICES_URL, fetchImpl, now)) as OpenRouterPrices, model)
    : priceIn((await readList(PRICE_LIST_URL, fetchImpl, now)) as PriceList, model);
}

/** Forgets the cached price lists (tests). */
export const resetPriceCache = () => cached.clear();

/** Tokens of one or more calls, split the way they are priced. */
export type Tokens = { input: number; cacheRead: number; cacheWrite: number; output: number };

/** Micro-dollars for tokens at a price. */
export const costMicros = (price: Price, t: Tokens) =>
  Math.round((t.input * price.input + t.cacheRead * price.cacheRead + t.cacheWrite * price.cacheWrite + t.output * price.output) * 1_000_000);

/**
 * Counts the cost of every call made through the models it wraps, so one action's cost can be recorded once at the
 * end, whatever number of calls it took. A call whose provider reports what it billed (OpenRouter) is counted at that
 * amount; any other call is priced from its tokens.
 */
export function meter(price: Price) {
  const t: Tokens = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
  let billedUsd = 0;
  return {
    language(model: LanguageModel): LanguageModel {
      return wrapLanguageModel({
        model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
        middleware: {
          specificationVersion: "v4",
          wrapGenerate: async ({ doGenerate }) => {
            const r = await doGenerate();
            const billed = rate((r.providerMetadata?.openrouter as { usage?: { cost?: unknown } } | undefined)?.usage?.cost);
            if (!Number.isNaN(billed)) {
              billedUsd += billed;
              return r;
            }
            const read = r.usage.inputTokens.cacheRead ?? 0;
            const write = r.usage.inputTokens.cacheWrite ?? 0;
            t.cacheRead += read;
            t.cacheWrite += write;
            t.input += r.usage.inputTokens.noCache ?? Math.max(0, (r.usage.inputTokens.total ?? 0) - read - write);
            t.output += r.usage.outputTokens.total ?? 0;
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
          // A decision model reports only totals, so its input is priced as plain input.
          t.input += r.usage?.inputTokens ?? 0;
          t.output += r.usage?.outputTokens ?? 0;
          return r;
        },
      };
    },
    /** Micro-dollars spent through these models so far. */
    spent: () => costMicros(price, t) + Math.round(billedUsd * 1_000_000),
  };
}
