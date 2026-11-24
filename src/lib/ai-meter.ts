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
import * as z from "zod";
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

// The lists are read, not trusted. A row or rate that is not the expected shape reads as unlisted, as it did when
// the fields were only looked up: priceFrom then answers null for it.
const RateFields = { prompt: z.unknown().optional(), completion: z.unknown().optional(), input_cache_read: z.unknown().optional(), input_cache_write: z.unknown().optional() };
const OpenRouterRatesShape = z.looseObject(RateFields).catch({});
const OpenRouterModelShape = z.object({
  id: z.string(),
  pricing: z.looseObject({ ...RateFields, overrides: z.array(OpenRouterRatesShape).optional().catch(undefined) }).optional().catch(undefined),
});
const OpenRouterListShape = z.object({ data: z.array(z.unknown()).optional().catch(undefined) }).catch({});
const PriceListShape = z.record(z.string(), z.looseObject({
  input_cost_per_token: z.unknown().optional(),
  output_cost_per_token: z.unknown().optional(),
  cache_read_input_token_cost: z.unknown().optional(),
  cache_creation_input_token_cost: z.unknown().optional(),
}).catch({})).catch({});
const OpenRouterUsageShape = z.object({ usage: z.object({ cost: z.unknown().optional() }).optional().catch(undefined) }).catch({});

/** OpenRouter's models list as read: entries without a string id are left out, as no model id can match them. */
function openRouterPrices(json: unknown): OpenRouterPrices {
  const { data } = OpenRouterListShape.parse(json);
  if (data === undefined) return {};
  return { data: data.flatMap((m) => {
    const parsed = OpenRouterModelShape.safeParse(m);
    return parsed.success ? [parsed.data] : [];
  }) };
}

/** A rate given as a number or a numeric string, else NaN. */
function rateNumber(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

/** A listed rate as a number, or NaN when it is missing, not a number, infinite or negative. */
function rate(v: unknown): number {
  const n = rateNumber(v);
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
  const all = tiers.filter((t): t is Price => t !== null);
  if (all.length !== tiers.length) return null;
  const max = (k: keyof Price) => Math.max(...all.map((t) => t[k]));
  return { input: max("input"), output: max("output"), cacheRead: max("cacheRead"), cacheWrite: max("cacheWrite") };
}

/** Whether a decision model object answers decisions itself (doDecide), so its calls can be counted. */
function isDecisionModelV4(m: Exclude<DecisionModel, string>): m is Experimental_DecisionModelV4 {
  return "doDecide" in m;
}

const cached = new Map<string, { promise: Promise<unknown>; expires: number }>();

/** One list, cached as a promise for a day; a failed read is not kept. */
function readList(url: string, fetchImpl: typeof fetch, now: number): Promise<unknown> {
  const hit = cached.get(url);
  if (hit && hit.expires > now) return hit.promise;
  const promise = fetchImpl(url, { signal: AbortSignal.timeout(15_000) }).then(async (r) => {
    if (!r.ok) throw new Error(`price list answered ${r.status}`);
    const body: unknown = await r.json();
    return body;
  });
  cached.set(url, { promise, expires: now + DAY_MS });
  promise.catch(() => { if (cached.get(url)?.promise === promise) cached.delete(url); });
  return promise;
}

/** The model's price from the list that covers its provider. */
export async function priceFor(provider: Provider, model: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<Price | null> {
  return provider === "openrouter"
    ? openRouterPriceIn(openRouterPrices(await readList(OPENROUTER_PRICES_URL, fetchImpl, now)), model)
    : priceIn(PriceListShape.parse(await readList(PRICE_LIST_URL, fetchImpl, now)), model);
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
      // A bare model id cannot be wrapped; the AI SDK would throw on it too (it proxies the model object).
      if (typeof model === "string") throw new TypeError(`The meter needs a model object, not the id "${model}".`);
      return wrapLanguageModel({
        model,
        middleware: {
          specificationVersion: "v4",
          wrapGenerate: async ({ doGenerate }) => {
            const r = await doGenerate();
            const billed = rate(OpenRouterUsageShape.parse(r.providerMetadata?.openrouter).usage?.cost);
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
      if (!model || typeof model === "string" || !isDecisionModelV4(model)) return model;
      const inner = model;
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
