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
  it("still saves, marked unchecked, when only flag-it rules exist or there is simply no key", async () => {
    expect((await applyPlaybook(drafts, [slot("a"), slot("c")], [warn], null, "capped")).keep).toHaveLength(2);
    expect((await applyPlaybook(drafts, [slot("a"), slot("c")], [block], null, null)).check).toBe("no-model");
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
    const verdicts = new Map([["a", [v("w", "warn", "fail", "Brühe")]], ["c", [v("b", "block", "unsure")]]]);
    const r = await applyPlaybook(drafts, [slot("a"), slot("c")], [block, warn], async () => verdicts);
    expect(r.keep).toHaveLength(2);
    expect(flagsFor(r.keep, r.verdicts).map((f) => [f.slotId, f.verdict])).toEqual([["a", "fail"], ["c", "unsure"]]);
  });

  it("saves unchecked, and says why, when there is no model, no rule, no playbook or the check fails", async () => {
    expect((await applyPlaybook(drafts, [], [block], null)).check).toBe("no-model");
    expect((await applyPlaybook(drafts, [], [], vi.fn())).check).toBe("no-rules");
    expect((await applyPlaybook(drafts, [], null, vi.fn())).check).toBe("no-playbook");
    const failed = await applyPlaybook(drafts, [], [block], async () => { throw new Error("401"); });
    expect(failed).toMatchObject({ check: "failed", refused: [] });
    expect(failed.keep).toHaveLength(2);
    expect(checkNote("no-model")).toContain("add your AI key");
    expect(checkNote("judged")).toBeUndefined();
  });
});
