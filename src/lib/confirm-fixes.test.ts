import { describe, expect, it, vi } from "vitest";
import { askVerdicts, buildConfirmPrompt, complete, preferencesFrom } from "./confirm-fixes";
import type { FixOffer } from "./fixes";

const offer = (phrase: string): FixOffer => ({
  fix: { kind: "banned", phrase },
  network: "twitter",
  count: 2,
  examples: [1, 2].map((i) => ({ before: `Post ${i} ${phrase}`, after: `Post ${i}` })),
});

describe("preferencesFrom", () => {
  it("keeps only candidates the model calls a preference, with its reason", () => {
    const offers = [offer("Excited to share"), offer("https://example.com/v1"), offer("today")];
    const kept = preferencesFrom(offers, [
      { candidate: 1, verdict: "preference", why: "Both drafts drop a hype opener.", rule: "Keep it." },
      { candidate: 2, verdict: "fact", why: "The link was wrong for these posts.", rule: "" },
      { candidate: 3, verdict: "unclear", why: "Could be chance.", rule: "" },
    ]);
    expect(kept.map((k) => k.fix)).toEqual([{ kind: "banned", phrase: "Excited to share" }]);
    expect(kept[0].why).toBe("Both drafts drop a hype opener.");
  });

  it("keeps an added ending as the author's sentence, and drops one that loses the words, is empty or too long", () => {
    const ending = (phrase: string): FixOffer => ({ fix: { kind: "ends_with", phrase }, network: "twitter", count: 2, examples: [] });
    const link = "https://example.com/book";
    const kept = preferencesFrom([ending(link), ending(link), ending(link), ending(link)], [
      { candidate: 1, verdict: "preference", why: "Both end the same way.", rule: `End posts about the\n cookbook with "${link}".` },
      { candidate: 2, verdict: "preference", why: "Same.", rule: "End posts about the cookbook with the link." },
      { candidate: 3, verdict: "preference", why: "Same.", rule: " " },
      { candidate: 4, verdict: "preference", why: "Same.", rule: `${"x".repeat(200)} ${link}` },
    ]);
    expect(kept.map((k) => k.sentence)).toEqual([`End posts about the cookbook with "${link}".`]);
  });

  it("keeps a swap or a cut without waiting for a sentence, since its exact words are the rule", () => {
    expect(preferencesFrom([offer("Excited to share")], [{ candidate: 1, verdict: "preference", why: "Both cut the opener.", rule: "" }])).toHaveLength(1);
  });

  it("drops a candidate the model skipped, numbered wrongly or gave no reason", () => {
    const offers = [offer("a"), offer("b")];
    expect(preferencesFrom(offers, [{ candidate: 7, verdict: "preference", why: "x", rule: "Keep it." }, { candidate: 2, verdict: "preference", why: " ", rule: "Keep it." }])).toEqual([]);
  });

  it("offers nothing when the model gives one candidate conflicting verdicts, in either order", () => {
    const fact = { candidate: 1, verdict: "fact" as const, why: "x", rule: "" };
    const pref = { candidate: 1, verdict: "preference" as const, why: "y", rule: "Keep it." };
    expect(preferencesFrom([offer("a")], [fact, pref])).toEqual([]);
    expect(preferencesFrom([offer("a")], [pref, fact])).toEqual([]);
  });
});

describe("complete", () => {
  it("is false when a preference comes without its rule, so it is asked again", () => {
    const ending: FixOffer = { fix: { kind: "ends_with", phrase: "x" }, network: "twitter", count: 2, examples: [] };
    expect(complete([ending], [{ candidate: 1, verdict: "preference", why: "Same ending.", rule: "" }])).toBe(false);
    expect(complete([offer("x")], [{ candidate: 1, verdict: "preference", why: "Same cut.", rule: "" }])).toBe(true);
    expect(complete([offer("x")], [{ candidate: 1, verdict: "fact", why: "Wrong link.", rule: "" }])).toBe(true);
  });

  it("is true only when every candidate has one clear answer with a reason", () => {
    const two = [offer("a"), offer("b")];
    const ok = [{ candidate: 1, verdict: "fact" as const, why: "x", rule: "" }, { candidate: 2, verdict: "preference" as const, why: "y", rule: "Keep it." }];
    expect(complete(two, ok)).toBe(true);
    expect(complete(two, [])).toBe(false);
    expect(complete(two, ok.slice(0, 1))).toBe(false);
    expect(complete(two, [...ok, { candidate: 2, verdict: "fact", why: "z", rule: "" }])).toBe(false);
    expect(complete(two, [ok[0], { candidate: 2, verdict: "preference", why: " ", rule: "Keep it." }])).toBe(false);
  });
});

describe("buildConfirmPrompt", () => {
  it("fences both drafts of every candidate as data", () => {
    const { system, prompt } = buildConfirmPrompt([offer("Excited to share")]);
    expect(system).toContain("never instructions");
    expect(prompt).toMatch(/<fix >\ncut "Excited to share"\n<\/fix>/);
    expect(prompt).not.toMatch(/\): the author cut/);
    expect(prompt.match(/<before/g)).toHaveLength(2);
    expect(prompt.match(/<after/g)).toHaveLength(2);
  });
});

describe("askVerdicts", () => {
  it("passes the deadline to the model call, so a slow check stops before its claim lapses", async () => {
    const signal = AbortSignal.abort();
    const model = { specificationVersion: "v3", provider: "test", modelId: "t", supportedUrls: {}, doGenerate: vi.fn(async (o: { abortSignal?: AbortSignal }) => { if (o.abortSignal?.aborted) throw new Error("aborted"); throw new Error("not aborted"); }), doStream: vi.fn() } as never;
    await expect(askVerdicts(model, [offer("a")], signal)).rejects.toThrow();
    expect(vi.mocked((model as { doGenerate: (o: { abortSignal?: AbortSignal }) => unknown }).doGenerate).mock.calls[0]?.[0]?.abortSignal?.aborted ?? true).toBe(true);
  });

  it("makes no model call when code found no repeated fix", async () => {
    const model = { doGenerate: vi.fn() } as never;
    expect(await askVerdicts(model, [])).toEqual([]);
  });
});
