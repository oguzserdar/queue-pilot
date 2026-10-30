import { describe, expect, it, vi } from "vitest";
import { MAX_SLOTS, slotsToWrite, writeWeek, type WriteWeekDeps } from "./write-week";
import { PLAYBOOK_REFUSAL } from "./save-for-user";
import type { OpenSlot } from "./open-slots";

const now = new Date("2026-10-26T08:00:00Z");
const slot = (id: string, at: string): OpenSlot => ({ id, channelId: "c", channel: "Mark Evans", service: "linkedin", organizationId: null, at, local: at, timezone: "UTC" });
const saved = (slotId: string, text: string) => ({ slotId, channel: "Mark Evans", local: "", postId: `p-${slotId}`, network: "linkedin", text });
const done = (drafts: { slotId: string; text: string }[]) => ({ saved: drafts.map((d) => saved(d.slotId, d.text)), refused: [], requests: 1, flags: [], check: "judged" as const });

function deps(over: Partial<WriteWeekDeps> = {}): WriteWeekDeps {
  return {
    material: async () => [{ key: "s1:41", title: "Issue 41", url: null, text: "Soup." }],
    voice: async () => ({ note: null, examples: [] }),
    rules: async () => [],
    write: vi.fn(async (b) => b.slots.map((s: { id: string }) => ({ slotId: s.id, text: "Soup tonight.", sourceKey: "s1:41" }))),
    save: vi.fn(async (drafts) => done(drafts)),
    ...over,
  };
}

describe("slotsToWrite", () => {
  it("keeps the displayed next Monday to Sunday only, soonest first, capped", () => {
    const open = [slot("late", "2026-11-08T09:00:00Z"), slot("b", "2026-11-05T09:00:00Z"), slot("past", "2026-10-25T09:00:00Z"), slot("a", "2026-11-02T09:00:00Z"), slot("this-week", "2026-10-30T09:00:00Z"), slot("after", "2026-11-09T00:00:00Z")];
    expect(slotsToWrite(open, now, "UTC").map((s) => s.id)).toEqual(["a", "b", "late"]);
    const many = Array.from({ length: 20 }, (_, i) => slot(`s${i}`, new Date(Date.parse("2026-11-02T00:00:00Z") + (i + 1) * 3600_000).toISOString()));
    expect(slotsToWrite(many, now, "UTC")).toHaveLength(MAX_SLOTS);
  });

  it("honors an exact future slot beyond seven days without substituting another", async () => {
    const chosen = slot("chosen", "2026-11-08T09:00:00Z");
    const targets = slotsToWrite([chosen, slot("earlier", "2026-11-02T09:00:00Z")], now, "UTC", "chosen");
    const d = deps();
    await writeWeek(targets, now, d);
    expect(d.write).toHaveBeenCalledWith(expect.objectContaining({ slots: [expect.objectContaining({ id: "chosen" })] }));
    expect(slotsToWrite([chosen], now, "UTC", "unknown")).toEqual([]);
  });

  it("uses local week boundaries across the autumn clock change and only supplied known slots", () => {
    // Historical transition: Alberta stopped changing clocks in November 2026.
    const open = [slot("before", "2025-10-27T05:59:00Z"), slot("start", "2025-10-27T06:00:00Z"), slot("sunday", "2025-11-03T06:59:00Z"), slot("after", "2025-11-03T07:00:00Z")];
    expect(slotsToWrite(open, new Date("2025-10-23T12:00:00Z"), "America/Edmonton").map((s) => s.id)).toEqual(["start", "sunday"]);
    expect(slotsToWrite(open.slice(0, 2), new Date("2025-10-23T12:00:00Z"), "America/Edmonton").map((s) => s.id)).toEqual(["start"]);
  });
});

describe("writeWeek", () => {
  const open = [slot("a", "2026-10-27T09:00:00Z"), slot("b", "2026-10-28T09:00:00Z")];

  it("asks nothing of the AI when there is no empty slot or no material", async () => {
    const d = deps({ material: async () => [] });
    expect(await writeWeek([], now, d)).toEqual({ kind: "nothing", reason: "no-slots" });
    expect(await writeWeek(open, now, d)).toEqual({ kind: "nothing", reason: "no-material" });
    expect(d.write).not.toHaveBeenCalled();
  });

  it("saves what the AI wrote, marks the material it used and passes on how it was checked", async () => {
    const d = deps();
    const r = await writeWeek(open, now, d);
    expect(r).toMatchObject({ kind: "done", retried: 0, check: "judged" });
    expect(d.save).toHaveBeenCalledWith(expect.any(Array), ["s1:41"]);
  });

  it("rewrites once, with the reason, only the slots the playbook refused", async () => {
    let call = 0;
    const save = vi.fn(async (drafts: { slotId: string; text: string }[]) => {
      call++;
      if (call === 1) return { ...done(drafts.filter((x) => x.slotId === "a")), refused: [{ slotId: "b", reason: `${PLAYBOOK_REFUSAL}: "stock" (found "Brühe").` }] };
      return done(drafts);
    });
    const d = deps({ save });
    const r = await writeWeek(open, now, d);
    const second = (d.write as ReturnType<typeof vi.fn>).mock.calls[1][0];
    expect(second.slots.map((s: { id: string }) => s.id)).toEqual(["b"]);
    expect(second.retry).toEqual({ b: `${PLAYBOOK_REFUSAL}: "stock" (found "Brühe").` });
    expect(r).toMatchObject({ kind: "done", retried: 1, refused: [] });
  });

  it("reports a draft refused twice instead of forcing it in", async () => {
    const save = vi.fn(async (drafts: { slotId: string }[]) => ({ saved: [], refused: drafts.map((x) => ({ slotId: x.slotId, reason: `${PLAYBOOK_REFUSAL}: no` })), requests: 0, flags: [], check: "judged" as const }));
    const r = await writeWeek(open, now, deps({ save }));
    expect(save).toHaveBeenCalledTimes(2);
    expect(r).toMatchObject({ kind: "done", saved: [], retried: 2 });
    expect(r.kind === "done" && r.refused).toHaveLength(2);
  });

  it("does not rewrite a slot refused for a platform reason, such as a filled slot", async () => {
    const d = deps({ save: vi.fn(async () => ({ saved: [], refused: [{ slotId: "a", reason: "That slot is no longer empty" }], requests: 0, flags: [], check: "judged" as const })) });
    await writeWeek(open, now, d);
    expect(d.write).toHaveBeenCalledTimes(1);
  });
});
