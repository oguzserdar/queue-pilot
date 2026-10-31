import { afterEach, expect, it, vi } from "vitest";
import { generateText } from "ai";
import { modelFor } from "./ai-model";
afterEach(() => vi.unstubAllGlobals());
it("requests accounting through the real SDK and reads OpenRouter's actual cost field", async () => {
  let body: Record<string, unknown> = {};
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    body = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: "test", model: "test/model", created: 1, choices: [{ index: 0, message: { role: "assistant", content: "Hello" }, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 2, total_tokens: 7, cost: 0.001234 } }), { headers: { "content-type": "application/json" } });
  }));
  const model = modelFor({ provider: "openrouter", model: "test/model", key: "test-only" });
  const result = await generateText({ model, prompt: "Hi", maxRetries: 0 });
  expect(body.usage).toEqual({ include: true });
  expect(result.providerMetadata?.openrouter).toMatchObject({ usage: { cost: 0.001234 } });
});
