import { describe, expect, it } from "vitest";
import { fillWeekPrompt } from "./fill-week-prompt";

describe("fillWeekPrompt", () => {
  it("names the connector tools in order, voice first", () => {
    const p = fillWeekPrompt();
    const at = (t: string) => p.indexOf(t);
    expect(at("get_my_voice")).toBeGreaterThan(-1);
    expect(at("get_my_voice")).toBeLessThan(at("get_playbook"));
    expect(at("get_playbook")).toBeLessThan(at("list_new_material"));
    expect(at("list_new_material")).toBeLessThan(at("list_open_slots"));
    expect(at("list_open_slots")).toBeLessThan(at("save_drafts"));
    expect(p).toContain("sourceKeys");
    expect(p).toMatch(/not saved/);
  });

  it("includes the user's note, trimmed and capped", () => {
    expect(fillWeekPrompt("  launch week  ")).toContain('"launch week"');
    expect(fillWeekPrompt("x".repeat(900))).toContain("x".repeat(500) + '"');
    expect(fillWeekPrompt("   ")).not.toContain("note for the week");
  });
});
