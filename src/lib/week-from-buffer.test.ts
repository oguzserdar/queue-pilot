import { describe, expect, it } from "vitest";
import type { Channel, Post } from "./buffer/queries";
import { openSlots } from "./open-slots";
import { cellEntries, countOpenSlots, slotKey, zoneLabel } from "./week-model";
import { nextWeekRange, weekFromBuffer } from "./week-from-buffer";

const channel = (over: Partial<Channel> = {}): Channel => ({
  id: "c1", name: "X", service: "twitter", timezone: "Europe/Istanbul",
  isDisconnected: false, isLocked: false, isQueuePaused: false,
  postingSchedule: [{ day: "mon", paused: false, times: ["09:00"] }, { day: "wed", paused: false, times: ["12:00", "18:30"] }],
  ...over,
});
const post = (over: Partial<Post>): Post => ({ id: "p", channelId: "c1", status: "scheduled", text: "t", dueAt: null, sentAt: null, externalLink: null, error: null, ...over });

describe("nextWeekRange", () => {
  it("starts at the following Monday midnight in the timezone, even on a Monday", () => {
    // Tue 20 Oct 2026 15:00 Istanbul (UTC+3) → Mon 26 Oct 00:00 Istanbul = Sun 25 Oct 21:00 UTC.
    const r = nextWeekRange(new Date("2026-10-20T12:00:00Z"), "Europe/Istanbul");
    expect(r.start.toISOString()).toBe("2026-10-25T21:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-11-01T21:00:00.000Z");
    const onMonday = nextWeekRange(new Date("2026-10-26T09:00:00Z"), "Europe/Istanbul");
    expect(onMonday.start.toISOString()).toBe("2026-11-01T21:00:00.000Z");
  });
});

describe("weekFromBuffer", () => {
  const range = nextWeekRange(new Date("2026-10-20T12:00:00Z"), "Europe/Istanbul");

  it("labels the week and its days in the reference timezone", () => {
    const w = weekFromBuffer([channel()], [], range, "Europe/Istanbul");
    expect(w.label).toBe("Mon 26 Oct – Sun 1 Nov 2026");
    expect(w.days).toEqual(["Mon 26", "Tue 27", "Wed 28", "Thu 29", "Fri 30", "Sat 31", "Sun 1"]);
  });

  it("names each empty slot with the same id the save accepts, so clicking one writes into that time", () => {
    const w = weekFromBuffer([channel()], [], range, "Europe/Istanbul");
    const open = new Set(openSlots([channel()], [], range).slots.map((s) => s.id));
    expect(w.slotIds?.[slotKey("c1", 0, "9:00")]).toBe("c1@2026-10-26T06:00:00.000Z");
    expect(Object.values(w.slotIds ?? {}).every((id) => open.has(id))).toBe(true);
    expect(Object.keys(w.slotIds ?? {})).toHaveLength(3);
  });

  it("places slots on their local day and time", () => {
    const w = weekFromBuffer([channel()], [], range, "Europe/Istanbul");
    expect(w.slots.c1).toEqual({ 0: ["9:00"], 2: ["12:00", "18:30"] });
    expect(countOpenSlots(w)).toBe(3);
  });

  it("puts posts into their slot and leaves out posts outside the week or on unknown channels", () => {
    const w = weekFromBuffer([channel()], [
      post({ id: "a", dueAt: "2026-10-28T09:00:00Z" }), // Wed 12:00 Istanbul
      post({ id: "b", dueAt: "2026-11-05T09:00:00Z" }), // next-next week
      post({ id: "c", channelId: "gone", dueAt: "2026-10-26T06:00:00Z" }),
      post({ id: "d", status: "error", dueAt: "2026-10-26T06:00:00Z", error: { message: "Image could not load", supportUrl: null } }),
    ], range, "Europe/Istanbul");
    expect(w.posts.map((p) => [p.id, p.day, p.time, p.status])).toEqual([["a", 2, "12:00", "scheduled"], ["d", 0, "9:00", "error"]]);
    expect(w.posts[1].error?.message).toBe("Image could not load");
    // The failed post leaves Monday 9:00 open to refill, as open-slots.ts and "Write my week" treat it.
    expect(countOpenSlots(w)).toBe(2);
  });
});

describe("cellEntries", () => {
  const range = nextWeekRange(new Date("2026-10-20T12:00:00Z"), "Europe/Istanbul");
  it("shows every post in a day, including one at a custom time and two at the same time, in time order", () => {
    const w = weekFromBuffer([channel()], [
      post({ id: "a", dueAt: "2026-10-28T09:00:00Z" }), // Wed 12:00, a slot
      post({ id: "b", dueAt: "2026-10-28T09:00:00Z" }), // Wed 12:00 again
      post({ id: "c", dueAt: "2026-10-28T07:15:00Z" }), // Wed 10:15, not a slot
    ], range, "Europe/Istanbul");
    expect(cellEntries(w, "c1", 2).map((e) => [e.time, e.slot, e.posts.map((p) => p.id)])).toEqual([
      ["10:15", false, ["c"]],
      ["12:00", true, ["a", "b"]],
      ["18:30", true, []],
    ]);
  });
  it("orders 9:00 before 10:00 (times are compared as times, not text)", () => {
    const w = weekFromBuffer([channel({ postingSchedule: [{ day: "mon", paused: false, times: ["10:00", "09:00"] }] })], [], range, "Europe/Istanbul");
    expect(cellEntries(w, "c1", 0).map((e) => e.time)).toEqual(["9:00", "10:00"]);
  });
});

describe("time zones on the week", () => {
  const range = nextWeekRange(new Date("2026-10-20T12:00:00Z"), "Europe/Istanbul");
  it("keeps the week's zone and each channel's own zone, since slots post in the channel's zone", () => {
    const w = weekFromBuffer([channel(), channel({ id: "c2", name: "LinkedIn", timezone: "America/New_York" })], [], range, "Europe/Istanbul");
    expect(w.timeZone).toBe("Europe/Istanbul");
    expect(w.channels.map((c) => c.timezone)).toEqual(["Europe/Istanbul", "America/New_York"]);
  });
  it("names a zone by its city and its offset on that date", () => {
    expect(zoneLabel("Europe/Istanbul", new Date("2026-10-26T12:00:00Z"))).toBe("Istanbul, GMT+3");
    expect(zoneLabel("America/New_York", new Date("2026-11-02T12:00:00Z"))).toBe("New York, GMT-5");
    expect(zoneLabel("America/New_York", new Date("2026-10-26T12:00:00Z"))).toBe("New York, GMT-4");
  });
});


describe("firstEmptySlot", () => {
  it("picks the earliest empty slot on a channel Buffer can post to", async () => {
    const { firstEmptySlot } = await import("./week-model");
    const week = {
      label: "", days: [], posts: [{ id: "p", channel: "a", day: 0, time: "9:00", status: "draft", text: "x" }],
      channels: [{ id: "a", name: "A", isDisconnected: false, isQueuePaused: false }, { id: "b", name: "B", isDisconnected: true, isQueuePaused: false }],
      slots: { a: { 0: ["9:00", "17:00"], 2: ["8:00"] }, b: { 0: ["7:00"] } },
    } as never;
    expect(firstEmptySlot(week)).toEqual({ channelId: "a", day: 0, time: "17:00" });
  });
});
