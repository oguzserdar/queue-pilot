import { describe, expect, it, vi } from "vitest";
import { applyPlaybook, checkNote, flagsFor, PLAYBOOK_REFUSAL } from "./save-for-user";
import type { Verdict } from "./judge";
import type { OpenSlot } from "./open-slots";
import type { Rule } from "./rules";

const slot = (id: string, service = "linkedin") => ({ id, service }) as OpenSlot;
const block: Rule = { id: "b", kind: "replace", from: "broth", to: "stock", channels: "all", level: "block", text: 'Say "stock".' };
const warn: Rule = { id: "w", kind: "guidance", channels: "all", level: "warn", text: "Name the dish first." };
const v = (ruleId: string, level: Rule["level"], verdict: Verdict["verdict"], quote = ""): Verdict => ({ ruleId, rule: ruleId === "b" ? block.text : warn.text, level, verdict, probability: 0.9, quote, reason: "why" });
const drafts = [{ slotId: "a", text: "Brühe" }, { slotId: "c", text: "Soup" }];

describe("applyPlaybook", () => {
  it("refuses every draft when the daily AI cap stopped the check and a do-not-save rule exists", async () => {
    const r = await applyPlaybook(drafts, [slot("a"), slot("c")], [block, warn], null, "Not saved: out of AI actions.");
    expect(r.keep).toEqual([]);
    expect(r.refused.map((x) => x.slotId)).toEqual(["a", "c"]);
    expect(r.refused[0].reason).toBe("Not saved: out of AI actions.");
  });
  it("saves warning-only drafts unchecked, but holds mandatory checks even without a key", async () => {
    expect((await applyPlaybook(drafts, [slot("a"), slot("c")], [warn], null, "capped")).keep).toHaveLength(2);
    expect((await applyPlaybook(drafts, [slot("a"), slot("c")], [block], null, null)).check).toBe("no-model");
    expect((await applyPlaybook(drafts, [slot("a"), slot("c")], [block], null)).keep).toEqual([]);
  });
  it("refuses a draft that fails a do-not-save rule, with the rule and the quoted words", async () => {
    const judge = vi.fn(async () => new Map([["a", [v("b", "block", "fail", "Brühe")]], ["c", [v("b", "block", "pass")]]]));
    const r = await applyPlaybook(drafts, [slot("a"), slot("c")], [block], judge);
    expect(r.keep.map((d) => d.slotId)).toEqual(["c"]);
    expect(r.refused[0].reason).toBe(`${PLAYBOOK_REFUSAL}: "${block.text}" (found "Brühe"). why`);
    expect(r.check).toBe("judged");
    expect(judge).toHaveBeenCalledWith([{ slotId: "a", text: "Brühe", network: "linkedin" }, { slotId: "c", text: "Soup", network: "linkedin" }], [block]);
  });

  it("keeps a draft that fails only a flag-it rule, or is unsure, and flags it", async () => {
    const verdicts = new Map([["a", [v("w", "warn", "fail", "Brühe"), v("b", "block", "pass")]], ["c", [v("b", "block", "unsure"), v("w", "warn", "pass")]]]);
    const r = await applyPlaybook(drafts, [slot("a"), slot("c")], [block, warn], async () => verdicts);
    expect(r.keep).toHaveLength(2);
    expect(flagsFor(r.keep, r.verdicts).map((f) => [f.slotId, f.verdict])).toEqual([["a", "fail"], ["c", "unsure"]]);
  });

  it("holds drafts when the playbook cannot be read or mandatory checking fails", async () => {
    expect((await applyPlaybook(drafts, [], [block], null)).check).toBe("no-model");
    expect((await applyPlaybook(drafts, [], [], vi.fn())).check).toBe("no-rules");
    expect(await applyPlaybook(drafts, [], null, vi.fn())).toMatchObject({ check: "no-playbook", keep: [] });
    const failed = await applyPlaybook(drafts, [], [block], async () => { throw new Error("401"); });
    expect(failed).toMatchObject({ check: "failed", keep: [] });
    expect(failed.refused).toHaveLength(2);
    expect(checkNote("no-model")).toContain("AI is unavailable");
    expect(checkNote("judged")).toBeUndefined();
  });

  it("holds only networks with mandatory rules when one judge in the batch fails", async () => {
    const r = await applyPlaybook(drafts, [slot("a"), slot("c", "twitter")], [{ ...block, channels: ["linkedin"] }, warn], async () => {
      await Promise.all([Promise.resolve([v("b", "block", "fail")]), Promise.reject(new Error("Provider unavailable"))]);
      return new Map();
    });
    expect(r.keep.map((d) => d.slotId)).toEqual(["c"]);
    expect(r.refused.map((d) => d.slotId)).toEqual(["a"]);
    expect(r.check).toBe("failed");
  });

  it("holds missing mandatory results, including a judge answer marked unavailable", async () => {
    for (const answer of [new Map<string, Verdict[]>(), new Map([["a", [{ ...v("b", "block", "unsure"), unavailable: true }]]])]) {
      const r = await applyPlaybook(drafts, [slot("a"), slot("c")], [block], async () => answer);
      expect(r.keep).toEqual([]);
      expect(r.refused).toHaveLength(2);
      expect(r.refused[0].reason).not.toContain(PLAYBOOK_REFUSAL);
    }
  });
});
