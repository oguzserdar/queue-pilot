import { generateText } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { answering, deciding } from "./ai-test-model";
import { costMicros, meter, OPENROUTER_PRICES_URL, openRouterPriceIn, priceFor, priceIn, PRICE_LIST_URL, resetPriceCache, type Price } from "./ai-meter";

// Claude Sonnet 5.5 at Anthropic's published rates: $2 input, $10 output, $0.10 cache hits, $2.50 5-minute cache writes per million tokens.
const SONNET: Price = { input: 0.000002, output: 0.00001, cacheRead: 0.0000001, cacheWrite: 0.0000025 };
const LIST = {
  "claude-sonnet-5-5": { input_cost_per_token: 0.000002, output_cost_per_token: 0.00001, cache_read_input_token_cost: 0.0000001, cache_creation_input_token_cost: 0.0000025 },
  "no-cache-prices": { input_cost_per_token: 0.000001, output_cost_per_token: 0.000004 },
  "half-listed": { input_cost_per_token: 0.000001 },
};
const OPENROUTER = { data: [
  { id: "anthropic/claude-sonnet-5.5", pricing: { prompt: "0.000002", completion: "0.00001", input_cache_read: "0.0000001", input_cache_write: "0.0000025" } },
  { id: "half-priced", pricing: { prompt: "0.000001" } },
] };
const zero = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };

beforeEach(() => resetPriceCache());

describe("prices", () => {
  it("reads an Anthropic or OpenAI model's prices, cache rates included, from the price list", () => {
    expect(priceIn(LIST, "claude-sonnet-5-5")).toEqual(SONNET);
  });
  it("charges cached tokens the plain input price when a model lists no cache prices", () => {
    expect(priceIn(LIST, "no-cache-prices")).toEqual({ input: 0.000001, output: 0.000004, cacheRead: 0.000001, cacheWrite: 0.000001 });
  });
  it("reads an OpenRouter model's prices from OpenRouter's own list", () => {
    expect(openRouterPriceIn(OPENROUTER, "anthropic/claude-sonnet-5.5")).toEqual(SONNET);
  });
  it("refuses a model whose input or output rate is not a usable number, from either list", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, "bad", ""]) {
      expect(priceIn({ m: { input_cost_per_token: bad, output_cost_per_token: 0.00001 } }, "m")).toBeNull();
      expect(priceIn({ m: { input_cost_per_token: 0.000002, output_cost_per_token: bad } }, "m")).toBeNull();
      expect(openRouterPriceIn({ data: [{ id: "m", pricing: { prompt: String(bad), completion: "0.00001" } }] }, "m")).toBeNull();
    }
  });
  it("charges the plain input rate for a cache rate that is not a usable number, never less", () => {
    const at = { input: 0.000002, output: 0.00001, cacheRead: 0.000002, cacheWrite: 0.000002 };
    expect(priceIn({ m: { input_cost_per_token: 0.000002, output_cost_per_token: 0.00001, cache_read_input_token_cost: -1, cache_creation_input_token_cost: "bad" } }, "m")).toEqual(at);
    expect(openRouterPriceIn({ data: [{ id: "m", pricing: { prompt: "0.000002", completion: "0.00001", input_cache_read: "-1", input_cache_write: "x" } }] }, "m")).toEqual(at);
  });
  it("takes the highest of OpenRouter's base and override rates, so a long prompt is never priced low", () => {
    // OpenRouter's own row for a model with a long-prompt override (min_prompt_tokens 272,000).
    const list = { data: [{ id: "long", pricing: { prompt: "0.000001", completion: "0.000005", input_cache_read: "0.00000005", input_cache_write: "0.00000125",
      overrides: [{ min_prompt_tokens: 272000, prompt: "0.000002", completion: "0.0000075", input_cache_read: "0.0000001", input_cache_write: "0.0000025" }] } }] };
    expect(openRouterPriceIn(list, "long")).toEqual({ input: 0.000002, output: 0.0000075, cacheRead: 0.0000001, cacheWrite: 0.0000025 });
  });
  it("refuses an OpenRouter model with an override it cannot read", () => {
    expect(openRouterPriceIn({ data: [{ id: "m", pricing: { prompt: "0.000001", completion: "0.000005", overrides: [{ prompt: "-1" }] } }] }, "m")).toBeNull();
  });
  it("has no price for an unlisted or half-listed model, so it cannot run on the built-in key", () => {
    expect(priceIn(LIST, "unknown")).toBeNull();
    expect(priceIn(LIST, "half-listed")).toBeNull();
    expect(openRouterPriceIn(OPENROUTER, "unknown")).toBeNull();
    expect(openRouterPriceIn(OPENROUTER, "half-priced")).toBeNull();
  });
  it("asks OpenRouter for OpenRouter models and the price list for the rest, each once a day", async () => {
    const f = vi.fn(async (url: string) => Response.json(url === OPENROUTER_PRICES_URL ? OPENROUTER : LIST));
    const fetchImpl = f as unknown as typeof fetch;
    expect(await priceFor("openrouter", "anthropic/claude-sonnet-5.5", fetchImpl, 0)).toEqual(SONNET);
    expect(await priceFor("anthropic", "claude-sonnet-5-5", fetchImpl, 0)).toEqual(SONNET);
    await priceFor("anthropic", "claude-sonnet-5-5", fetchImpl, 1000);
    expect(f.mock.calls.map((c) => c[0])).toEqual([OPENROUTER_PRICES_URL, PRICE_LIST_URL]);
  });
  it("retries after a failed read", async () => {
    const bad = vi.fn(async () => new Response("", { status: 503 }));
    await expect(priceFor("anthropic", "x", bad as unknown as typeof fetch, 0)).rejects.toThrow("503");
    const ok = vi.fn(async () => Response.json(LIST));
    expect(await priceFor("anthropic", "claude-sonnet-5-5", ok as unknown as typeof fetch, 0)).not.toBeNull();
  });
  it("prices tokens in micro-dollars: 10,000 in and 2,000 out on Sonnet 5.5 is 4 cents", () => {
    expect(costMicros(SONNET, { ...zero, input: 10_000, output: 2_000 })).toBe(40_000);
  });
  it("prices cache hits and cache writes at their own rates", () => {
    // 100,000 cache hits at $0.10 per million is 1 cent; 10,000 cache writes at $2.50 per million is 2.5 cents.
    expect(costMicros(SONNET, { ...zero, cacheRead: 100_000 })).toBe(10_000);
    expect(costMicros(SONNET, { ...zero, cacheWrite: 10_000 })).toBe(25_000);
  });
});

describe("meter", () => {
  it("adds up the tokens of every call made through its models", async () => {
    const m = meter(SONNET);
    const model = m.language(answering("one", "two"));
    await generateText({ model, prompt: "a" });
    await generateText({ model, prompt: "b" });
    // The test model reports 1 plain input and 1 output token per call.
    expect(m.spent()).toBe(costMicros(SONNET, { ...zero, input: 2, output: 2 }));
  });
  it("prices a call's cache hits and cache writes apart from its plain input", async () => {
    const m = meter(SONNET);
    const usage = { inputTokens: { total: 111_000, noCache: 1_000, cacheRead: 100_000, cacheWrite: 10_000 }, outputTokens: { total: 0, text: 0, reasoning: 0 } };
    const model = m.language(new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: "text", text: "ok" }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] }) }));
    await generateText({ model, prompt: "a" });
    expect(m.spent()).toBe(costMicros(SONNET, { input: 1_000, cacheRead: 100_000, cacheWrite: 10_000, output: 0 }));
  });
  it("counts what OpenRouter reports it billed for a call, instead of pricing that call's tokens", async () => {
    const m = meter(SONNET);
    const usage = { inputTokens: { total: 300_000, noCache: 300_000, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1_000, text: 1_000, reasoning: 0 } };
    const billed = (cost: number) => new MockLanguageModelV4({ doGenerate: async () => ({ content: [{ type: "text", text: "ok" }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [], providerMetadata: { openrouter: { usage: { cost } } } }) });
    await generateText({ model: m.language(billed(1.25)), prompt: "a" });
    expect(m.spent()).toBe(1_250_000);
    // An unusable reported cost is ignored and the tokens are priced instead.
    await generateText({ model: m.language(billed(-5)), prompt: "b" });
    expect(m.spent()).toBe(1_250_000 + costMicros(SONNET, { ...zero, input: 300_000, output: 1_000 }));
  });
  it("counts a decision model's reported tokens too", async () => {
    const m = meter({ input: 1, output: 1, cacheRead: 1, cacheWrite: 1 });
    const { model } = deciding(() => ({}));
    const wrapped = m.decider({ ...model, doDecide: async (o) => ({ ...(await model.doDecide(o)), usage: { inputTokens: 3, outputTokens: 2 } }) });
    await (wrapped as typeof model).doDecide({ questions: {}, state: [] } as never);
    expect(m.spent()).toBe(5_000_000);
  });
});
