import { APICallError } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { expect, it, vi } from "vitest";
import { answering } from "./ai-test-model";
import { contextTooLarge, withSourceContext } from "./source-context";
const tooBig = () => new APICallError({ message: "maximum context length exceeded", url: "https://provider.test", requestBodyValues: {}, statusCode: 400, responseBody: "context_length_exceeded", isRetryable: false });
const usage = { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } };
it("processes every section after a real context-size rejection, retaining the ending", async () => {
 const text = "Opening finding. " + "Background discussion. ".repeat(200) + "Closing correction.";
 const read: string[] = [];
 const model = new MockLanguageModelV4({ doGenerate: async options => {
   const user = options.prompt.find(m => m.role === "user")!;
   const part = user.content.find(p => p.type === "text")!;
   if (part.type !== "text") throw new Error("text expected");
   const source = JSON.parse(part.text).source.text as string;
   if (source.length > 700) throw tooBig(); // A simulated provider limit, not a QP cap.
   read.push(source);
   const passages = ["Opening finding.", "Closing correction."].filter(quote => source.includes(quote)).map(quote => ({ quote }));
   return { content: [{ type: "text", text: JSON.stringify({ passages }) }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
 } });
 const renew = vi.fn(async () => {});
 const run = vi.fn(async (sources: { text: string }[], extracted: boolean) => { if (!extracted) throw tooBig(); return sources[0].text; });
 const result = await withSourceContext(model, [{ text }], "Find the opening and closing findings.", run, renew);
 expect(read.join("")).toBe(text); expect(read.length).toBeGreaterThan(1);
 expect(result).toContain("Opening finding."); expect(result).toContain("Closing correction.");
 expect(renew.mock.calls.length).toBe(model.doGenerateCalls.length + run.mock.calls.length);
});
it("does not treat arbitrary provider failures as context-size rejections", async () => {
 const run = vi.fn(async () => { throw new Error("offline"); }); const model = answering({ passages: [] });
 await expect(withSourceContext(model, [{ text: "Source." }], "task", run)).rejects.toThrow("offline");
 expect(model.doGenerateCalls).toHaveLength(0);
 expect(contextTooLarge(new APICallError({ message: "too many tokens", url: "https://provider.test", requestBodyValues: {}, statusCode: 429 }))).toBe(false);
});
it("does not produce a final answer after an extraction invents a quote", async () => {
 const run = vi.fn(async () => { throw tooBig(); });
 await expect(withSourceContext(answering({ passages: [{ quote: "Invented." }] }), [{ text: "Real." }], "task", run)).rejects.toThrow("not in the source");
 expect(run).toHaveBeenCalledOnce();
});
it("stops explicitly when reduction makes no progress rather than dropping the end", async () => {
 const run = vi.fn(async () => { throw tooBig(); });
 await expect(withSourceContext(answering({ passages: [{ quote: "Entire source." }] }), [{ text: "Entire source.", segments: [] }], "task", run)).rejects.toThrow("larger context window");
 expect(run).toHaveBeenCalledOnce();
});
it("keeps a verified cross-caption closing timestamp after extraction", async () => {
 const quote = "A closing sentence with evidence.";
 const run = vi.fn(async (sources: { text: string; segments?: { seconds: number }[] }[], extracted: boolean) => { if (!extracted) throw tooBig(); return sources[0]; });
 const result = await withSourceContext(answering({ passages: [{ quote, locator: "t=7190" }] }), [{ text: "Background. " + quote, segments: [{ text: "A closing sentence", seconds: 7190 }, { text: "with evidence.", seconds: 7194 }] }], "task", run);
 expect(result).toMatchObject({ text: quote, segments: [{ seconds: 7190 }] });
});
it("keeps duplicate caption text attached to its own timestamp when splitting", async () => {
 const segments = [{ text: "Repeated.", seconds: 0 }, { text: "Opening context.", seconds: 2 }, { text: "Repeated.", seconds: 7190 }, { text: "Closing context.", seconds: 7192 }];
 const seen: { text: string; seconds: number }[][] = [];
 const model = new MockLanguageModelV4({ doGenerate: async options => {
   const user = options.prompt.find(m => m.role === "user")!;
   const part = user.content.find(p => p.type === "text")!; if (part.type !== "text") throw new Error("text");
   const source = JSON.parse(part.text).source;
   if (source.segments.length > 2) throw tooBig();
   seen.push(source.segments);
   return { content: [{ type: "text", text: JSON.stringify({ passages: source.segments.some((s: { seconds: number }) => s.seconds === 7192) ? [{ quote: "Closing context.", locator: "t=7192" }] : [] }) }], finishReason: { unified: "stop", raw: "stop" }, usage, warnings: [] };
 } });
 const result = await withSourceContext(model, [{ text: segments.map(s => s.text).join(" "), segments }], "Closing findings", async (s, extracted) => { if (!extracted) throw tooBig(); return s[0]; });
 expect(seen.flat()).toEqual(segments);
 expect(result.segments).toEqual([{ text: "Closing context.", seconds: 7192 }]);
});
