import { generateText } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { answering, deciding } from "./ai-test-model";
import { costMicros, meter, priceFor, priceIn, PRICE_LIST_URL, resetPriceCache } from "./ai-meter";

const LIST = {
  "claude-sonnet-5-5": { input_cost_per_token: 0.000002, output_cost_per_token: 0.00001 },
  "openrouter/anthropic/claude-sonnet-5.5": { input_cost_per_token: 0.000002, output_cost_per_token: 0.00001 },
  "half-listed": { input_cost_per_token: 0.000001 },
};

beforeEach(() => resetPriceCache());

describe("prices", () => {
  it("reads a model's price by the id its key uses, and the OpenRouter form", () => {
    expect(priceIn(LIST, "anthropic", "claude-sonnet-5-5")).toEqual({ input: 0.000002, output: 0.00001 });
    expect(priceIn(LIST, "openrouter", "anthropic/claude-sonnet-5.5")).toEqual({ input: 0.000002, output: 0.00001 });
  });
  it("has no price for an unlisted or half-listed model, so it cannot run on the built-in key", () => {
    expect(priceIn(LIST, "anthropic", "unknown")).toBeNull();
    expect(priceIn(LIST, "anthropic", "half-listed")).toBeNull();
  });
  it("reads the list once a day and retries after a failed read", async () => {
    const ok = vi.fn(async () => Response.json(LIST));
    await priceFor("anthropic", "claude-sonnet-5-5", ok as unknown as typeof fetch, 0);
    await priceFor("anthropic", "claude-sonnet-5-5", ok as unknown as typeof fetch, 1000);
    expect(ok).toHaveBeenCalledTimes(1);
    expect((ok.mock.calls[0] as unknown as [string])[0]).toBe(PRICE_LIST_URL);
    resetPriceCache();
    const bad = vi.fn(async () => new Response("", { status: 503 }));
    await expect(priceFor("anthropic", "x", bad as unknown as typeof fetch, 0)).rejects.toThrow("503");
    expect(await priceFor("anthropic", "claude-sonnet-5-5", ok as unknown as typeof fetch, 0)).not.toBeNull();
  });
  it("prices tokens in micro-dollars: 10,000 in and 2,000 out on Sonnet 5.5 is 4 cents", () => {
    expect(costMicros({ input: 0.000002, output: 0.00001 }, 10_000, 2_000)).toBe(40_000);
  });
});

describe("meter", () => {
  it("adds up the tokens of every call made through its models", async () => {
    const m = meter({ input: 0.000002, output: 0.00001 });
    const model = m.language(answering("one", "two"));
    await generateText({ model, prompt: "a" });
    await generateText({ model, prompt: "b" });
    // The test model reports 1 input and 1 output token per call.
    expect(m.spent()).toBe(costMicros({ input: 0.000002, output: 0.00001 }, 2, 2));
  });
  it("counts a decision model's reported tokens too", async () => {
    const m = meter({ input: 1, output: 1 });
    const { model } = deciding(() => ({}));
    const wrapped = m.decider({ ...model, doDecide: async (o) => ({ ...(await model.doDecide(o)), usage: { inputTokens: 3, outputTokens: 2 } }) });
    await (wrapped as typeof model).doDecide({ questions: {}, state: [] } as never);
    expect(m.spent()).toBe(5_000_000);
  });
});
