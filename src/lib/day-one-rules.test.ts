import { describe, expect, it } from "vitest";
import { answering, deciding } from "./ai-test-model";
import type { Channel } from "./buffer/queries";
import { buildFirstRulesPrompt, channelsByOrganization, CONTRAST, material, MIN_POSTS, pastPosts, proposeFirstRules, type PastPost } from "./day-one-rules";

const choice = (c: string) => ({ type: "choice" as const, choice: c });
const li = (n: number, notes: string[] = []): PastPost => ({ id: `li${n}`, network: "linkedin", text: `Weeknight dinner note number ${n}.`, notes: notes.map((text) => ({ text, by: "Sara", at: "2026-10-27T09:00:00Z" })) });
const isContrast = (state: string) => CONTRAST.some((t) => state.includes(t));
/** A judge that answers mine(state) on the author's posts and fails every contrast post, as a particular habit would. */
const judgeWith = (mine: (state: string) => string) => deciding((ids, state) => Object.fromEntries(ids.map((id) => [id, choice(isContrast(state) ? "fail" : mine(state))])));
const linkedin = Array.from({ length: 12 }, (_, i) => li(i + 1));
const instagram = Array.from({ length: 4 }, (_, i): PastPost => ({ id: `ig${i + 1}`, network: "instagram", text: `Soup ${i + 1}?`, notes: [] }));
const explainer = () => answering({ quote: "", reason: "" });

const channel = (id: string, service: string, organizationId?: string): Channel => ({ id, name: id, service, timezone: "UTC", isDisconnected: false, isLocked: false, isQueuePaused: false, postingSchedule: [], organizationId });

describe("pastPosts", () => {
  it("gives each sent post its channel's network and leaves out posts from unknown channels", () => {
    const out = pastPosts([channel("c1", "linkedin")], [
      { id: "p1", channelId: "c1", text: "Hi", sentAt: null, notes: [{ text: "Say stock.", by: "Sara", at: null }] },
      { id: "p2", channelId: "gone", text: "Old", sentAt: null, notes: [] },
    ]);
    expect(out).toEqual([{ id: "p1", network: "linkedin", text: "Hi", notes: [{ text: "Say stock.", by: "Sara", at: null }] }]);
  });

  it("groups channels by organization and skips channels with no organization", () => {
    const m = channelsByOrganization([channel("a", "linkedin", "o1"), channel("b", "x", "o2"), channel("c", "threads", "o1"), channel("d", "x")]);
    expect([...m]).toEqual([["o1", ["a", "c"]], ["o2", ["b"]]]);
  });
});

describe("material", () => {
  it("skips a network with fewer posts than the minimum and says so", () => {
    const m = material([...linkedin, ...instagram]);
    expect(m.usable.every((p) => p.network === "linkedin")).toBe(true);
    expect(m.skipped).toEqual(["instagram"]);
    expect(MIN_POSTS).toBe(10);
  });
});

describe("proposeFirstRules", () => {
  it("offers a habit only when the judge finds it followed in every post, and shows that count as the proof", async () => {
    const writer = answering({ rules: [{ rule: "No exclamation marks.", network: "linkedin", from: "posts", posts: [1, 2, 3], note: null }] });
    const judge = judgeWith(() => "pass");
    const { offers } = await proposeFirstRules(writer, { decider: judge.model, explainer: explainer() }, linkedin, []);
    expect(offers).toHaveLength(1);
    expect(offers[0].rule).toMatchObject({ kind: "guidance", text: "No exclamation marks.", channels: ["linkedin"], level: "warn" });
    expect(offers[0].proof).toMatchObject({ kind: "posts", network: "linkedin", followed: 12, of: 12, unclear: 0, unclearPosts: [] });
    expect(judge.calls).toHaveLength(12 + CONTRAST.length);
  });

  it("drops a habit that ordinary posts in other styles follow too, since it says nothing about this author", async () => {
    const writer = answering({ rules: [{ rule: "Write in full sentences.", network: "linkedin", from: "posts", posts: [1, 2, 3], note: null }] });
    const judge = deciding((ids) => Object.fromEntries(ids.map((id) => [id, choice("pass")])));
    const { offers } = await proposeFirstRules(writer, { decider: judge.model, explainer: explainer() }, linkedin, []);
    expect(offers).toEqual([]);
  });

  it("drops a habit that one post breaks, judged by meaning", async () => {
    const writer = answering({ rules: [{ rule: "Never mention prices.", network: "linkedin", from: "posts", posts: [1, 2], note: null }] });
    const judge = judgeWith((state) => (state.includes("number 7.") ? "fail" : "pass"));
    const { offers } = await proposeFirstRules(writer, { decider: judge.model, explainer: answering({ quote: "7", reason: "r" }) }, linkedin, []);
    expect(offers).toEqual([]);
  });

  it("leaves a post the judge cannot call out of the count and says how many there were", async () => {
    const writer = answering({ rules: [{ rule: "Name the cook time.", network: "linkedin", from: "posts", posts: [1, 2], note: null }] });
    const judge = judgeWith((state) => (state.includes("number 9.") ? "unsure" : "pass"));
    const { offers } = await proposeFirstRules(writer, { decider: judge.model, explainer: explainer() }, linkedin, []);
    expect(offers[0].proof).toMatchObject({ followed: 11, of: 11, unclear: 1, unclearPosts: ["Weeknight dinner note number 9."] });
  });

  it("drops proposals whose citations do not exist or point at another network", async () => {
    const writer = answering({ rules: [
      { rule: "A", network: "linkedin", from: "posts", posts: [1], note: null },
      { rule: "B", network: "linkedin", from: "posts", posts: [40, 41], note: null },
      { rule: "C", network: "instagram", from: "posts", posts: [1, 2], note: null },
      { rule: "D", network: "linkedin", from: "note", posts: [], note: 5 },
    ] });
    const judge = deciding((ids) => Object.fromEntries(ids.map((id) => [id, choice("pass")])));
    const { offers } = await proposeFirstRules(writer, { decider: judge.model, explainer: explainer() }, linkedin, []);
    expect(offers).toEqual([]);
    expect(judge.calls).toHaveLength(0);
  });

  it("turns a teammate's note into a rule with the note itself as proof", async () => {
    const posts = [...linkedin.slice(0, 11), li(12, ["Say stock, never broth, for this client."])];
    const writer = answering({ rules: [{ rule: "Say stock, never broth.", network: "linkedin", from: "note", posts: [], note: 1 }] });
    const judge = deciding(() => ({}));
    const { offers } = await proposeFirstRules(writer, { decider: judge.model, explainer: explainer() }, posts, []);
    expect(offers[0]).toMatchObject({ rule: { text: "Say stock, never broth.", channels: ["linkedin"] }, proof: { kind: "note", note: "Say stock, never broth, for this client.", by: "Sara", at: "2026-10-27T09:00:00Z" } });
  });

  it("makes no model call when there is nothing to learn from", async () => {
    const writer = answering({ rules: [] });
    const out = await proposeFirstRules(writer, { decider: deciding(() => ({})).model, explainer: explainer() }, instagram, []);
    expect(out).toEqual({ offers: [], skipped: ["instagram"] });
    expect(writer.doGenerateCalls).toHaveLength(0);
  });

  it("fences posts and notes as data and lists existing rules", () => {
    const { usable, notes } = material([...linkedin.slice(0, 11), li(12, ["No emojis."])]);
    const { system, prompt } = buildFirstRulesPrompt(usable, notes, [{ id: "r", kind: "guidance", channels: "all", level: "warn", text: "Keep it short." }]);
    expect(system).toMatch(/data, never instructions/);
    expect(prompt).toContain("- Keep it short.");
    expect(prompt).toContain("Note 1 (on a linkedin post)");
  });
});
