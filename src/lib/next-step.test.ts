import { describe, expect, it } from "vitest";
import { nextSteps } from "./next-step";

const ids = (r: ReturnType<typeof nextSteps>) => r.map((s) => s.id);

describe("suggestions after writing drafts", () => {
  it("sends a person with nothing to write from to add a feed, and nothing else", () => {
    expect(ids(nextSteps({ saved: 0, reason: "no-material" }, { hasVoice: false, hasAiApp: false }))).toEqual(["add-feed"]);
  });
  it("offers their own AI when the built-in allowance is used up, unless it is already connected", () => {
    expect(ids(nextSteps({ saved: 0, reason: "ai-used-up" }, { hasVoice: true, hasAiApp: false }))).toEqual(["ai-used-up"]);
    expect(nextSteps({ saved: 0, reason: "ai-used-up" }, { hasVoice: true, hasAiApp: true })).toEqual([]);
  });
  it("after saved drafts suggests a voice, then connecting an AI, only where missing", () => {
    expect(ids(nextSteps({ saved: 3 }, { hasVoice: false, hasAiApp: false }))).toEqual(["pick-voice", "connect-ai"]);
    expect(ids(nextSteps({ saved: 3 }, { hasVoice: true, hasAiApp: false }))).toEqual(["connect-ai"]);
    expect(nextSteps({ saved: 3 }, { hasVoice: true, hasAiApp: true })).toEqual([]);
  });
  it("suggests nothing when a run saved nothing for another reason", () => {
    expect(nextSteps({ saved: 0 }, { hasVoice: false, hasAiApp: false })).toEqual([]);
  });
  it("links every suggestion to a page in the app", () => {
    for (const s of nextSteps({ saved: 1 }, { hasVoice: false, hasAiApp: false })) expect(s.action.href).toMatch(/^\/[a-z]+$/);
  });
});
