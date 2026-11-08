/**
 * @fileoverview Announcements: each destination is claimed before sending, a refusal can be resent by the person,
 * no answer reads as "may have been sent" and is never resent, and one person never sees another's rows.
 */
import { describe, expect, it } from "vitest";
import { memoryAnnounceStore, PENDING_MS, resendFailed, sendAnnouncement, shownStatus, type AnnounceDeps, type AnnounceItem } from "./announce";

class Refused extends Error {}
const tg: AnnounceItem = { kind: "telegram", target: "-100", label: "Pennyrow news", text: "Patch 1.4: exports resume after a dropped connection." };
const dc: AnnounceItem = { kind: "discord", target: "c1", label: "#announcements", text: "Patch 1.4 is out. Exports now resume." };

function deps(over: Partial<AnnounceDeps> = {}) {
  const sent: AnnounceItem[] = [];
  const d: AnnounceDeps = {
    store: memoryAnnounceStore(),
    post: async (item) => (sent.push(item), { link: item.kind === "discord" ? "https://discord.com/channels/g/c1/m1" : null }),
    refused: (e) => e instanceof Refused,
    newId: () => "a1",
    now: () => new Date("2026-11-08T10:00:00Z"),
    ...over,
  };
  return { d, sent };
}

describe("sendAnnouncement", () => {
  it("sends each destination its own exact text, with no Buffer post needed", async () => {
    const { d, sent } = deps();
    const out = await sendAnnouncement("u1", [tg, dc], d);
    expect(sent.map((s) => s.text)).toEqual([tg.text, dc.text]);
    expect(out.results.map((r) => [r.kind, r.status, r.link])).toEqual([["telegram", "sent", null], ["discord", "sent", "https://discord.com/channels/g/c1/m1"]]);
  });

  it("sends to one place when only one is chosen", async () => {
    const { d, sent } = deps();
    await sendAnnouncement("u1", [tg], d);
    expect(sent.map((s) => s.kind)).toEqual(["telegram"]);
  });

  it("never posts the same announcement twice, even when it is sent again with the same id", async () => {
    const { d, sent } = deps();
    await sendAnnouncement("u1", [tg], d);
    await sendAnnouncement("u1", [tg], d);
    expect(sent).toHaveLength(1);
  });

  it("marks a refusal as failed and no answer as uncertain", async () => {
    const { d } = deps({ post: async (item) => { if (item.kind === "telegram") throw new Refused("Bad Request: chat not found"); throw new DOMException("timeout", "TimeoutError"); } });
    const out = await sendAnnouncement("u1", [tg, dc], d);
    expect(out.results.map((r) => [r.kind, r.status])).toEqual([["telegram", "failed"], ["discord", "uncertain"]]);
    expect(out.results[1].error).toMatch(/may have been sent/);
  });

  it("refuses an empty choice and two messages for one place", async () => {
    const { d } = deps();
    await expect(sendAnnouncement("u1", [], d)).rejects.toThrow(/at least one/);
    await expect(sendAnnouncement("u1", [tg, tg], d)).rejects.toThrow(/one message/);
  });
});

describe("resendFailed", () => {
  it("resends a refused destination with the same text, and only once at a time", async () => {
    let fail = true;
    const { d, sent } = deps({ post: async (item) => { if (fail) throw new Refused("Missing Permissions"); sent.push(item); return { link: null }; } });
    await sendAnnouncement("u1", [dc], d);
    fail = false;
    const [a, b] = await Promise.all([resendFailed("u1", "a1", "discord", d), resendFailed("u1", "a1", "discord", d)]);
    expect([a?.status, b]).toEqual(["sent", null]);
    expect(sent.map((s) => s.text)).toEqual([dc.text]);
  });

  it("never resends a destination that may already have landed, or someone else's", async () => {
    const { d } = deps({ post: async () => { throw new DOMException("timeout", "TimeoutError"); } });
    await sendAnnouncement("u1", [dc], d);
    expect(await resendFailed("u1", "a1", "discord", d)).toBeNull();
    expect(await resendFailed("u2", "a1", "discord", d)).toBeNull();
  });
});

describe("shownStatus", () => {
  it("reads a claim with no result as uncertain once it is older than two minutes", () => {
    const at = new Date("2026-11-08T10:00:00Z");
    expect(shownStatus({ status: "pending", updatedAt: at }, new Date(at.getTime() + 60_000))).toBe("pending");
    expect(shownStatus({ status: "pending", updatedAt: at }, new Date(at.getTime() + PENDING_MS + 1))).toBe("uncertain");
  });
});
