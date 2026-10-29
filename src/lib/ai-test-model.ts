/**
 * Test helpers for AI SDK v7 code, used by *.test.ts files only. `answering` is a mock language model that answers
 * each call with the given objects in order (the last repeats). `deciding` is a decision model whose doDecide returns
 * the given answers, so tests run the SDK's real experimental_decide and generateText without a provider.
 */
import type { Experimental_DecisionModelV4, Experimental_DecisionModelV4Answer, Experimental_DecisionModelV4CallOptions } from "@ai-sdk/provider";
import { MockLanguageModelV4 } from "ai/test";

const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };

export function answering(...objects: unknown[]): MockLanguageModelV4 {
  let i = 0;
  return new MockLanguageModelV4({
    doGenerate: async () => {
      const o = objects[Math.min(i++, objects.length - 1)];
      return { content: [{ type: "text", text: typeof o === "string" ? o : JSON.stringify(o) }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
    },
  });
}

/** Everything the model was sent in one call, as text, for asserting on the prompt. */
export const sentText = (m: MockLanguageModelV4, call = 0) => JSON.stringify(m.doGenerateCalls[call].prompt);

/** A decision model answering from a function of the questions and the shared state; records each call. */
export function deciding(answer: (questionIds: string[], state: string) => Record<string, Experimental_DecisionModelV4Answer>) {
  const calls: Experimental_DecisionModelV4CallOptions[] = [];
  const model: Experimental_DecisionModelV4 = {
    specificationVersion: "v4",
    provider: "test",
    modelId: "test-decider",
    supportedQuestionTypes: ["choice", "score", "boolean"],
    async doDecide(options) {
      calls.push(options);
      const state = options.state.map((p) => ("text" in p ? p.text : JSON.stringify(p))).join("\n");
      return { answers: answer(Object.keys(options.questions), state), warnings: [] };
    },
  };
  return { model, calls };
}
