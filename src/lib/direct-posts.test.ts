/**
 * @fileoverview Posts: each destination is claimed before sending, a refusal can be resent by the person,
 * no answer reads as "may have been sent" and is never resent, and one person never sees another's rows.
 */
import { describe, expect, it } from "vitest";
import { postIdFor, memoryDirectPostStore, PENDING_MS, resendFailed, sendDirectPost, shownStatus, type DirectPostDeps, type PostItem } from "./direct-posts";

class Refused extends Error {}
const tg: PostItem = { kind: "telegram", target: "-100", label: "Pennyrow news", text: "Patch 1.4: exports resume after a dropped connection." };
const dc: PostItem = { kind: "discord", target: "c1", label: "#announcements", text: "Patch 1.4 is out. Exports now resume." };

function deps(over: Partial<DirectPostDeps> = {}) {
  const sent: PostItem[] = [];
  const d: DirectPostDeps = {
    store: memoryDirectPostStore(),
    post: async (item) => (sent.push(item), { link: item.kind === "discord" ? "https://discord.com/channels/g/c1/m1" : null }),
    refused: (e) => e instanceof Refused,
    now: () => new Date("2026-11-08T10:00:00Z"),
    ...over,
  };
  return { d, sent };
}

describe("sendDirectPost", () => {
  it("sends each destination its own exact text, with no Buffer post needed", async () => {
    const { d, sent } = deps();
    const out = await sendDirectPost("u1", "key-0001", [tg, dc], d);
    expect(sent.map((s) => s.text)).toEqual([tg.text, dc.text]);
    expect(out.results.map((r) => [r.kind, r.status, r.link])).toEqual([["telegram", "sent", null], ["discord", "sent", "https://discord.com/channels/g/c1/m1"]]);
  });

  it("sends to one place when only one is chosen", async () => {
    const { d, sent } = deps();
    await sendDirectPost("u1", "key-0001", [tg], d);
    expect(sent.map((s) => s.kind)).toEqual(["telegram"]);
  });

  it("sends once when the same form is submitted twice at the same moment, and both get the recorded result", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const { d, sent } = deps({ post: async (item) => { await gate; sent.push(item); return { link: "https://t.me/qp/7" }; } });
    const a = sendDirectPost("u1", "key-0001", [tg], d);
    const b = sendDirectPost("u1", "key-0001", [tg], d);
    release();
    const [ra, rb] = await Promise.all([a, b]);
    expect(sent).toHaveLength(1);
    expect(ra.postId).toBe(rb.postId);
    expect(rb.results).toHaveLength(1);
  });

  it("returns what was recorded when a finished form is submitted again", async () => {
    const { d, sent } = deps();
    await sendDirectPost("u1", "key-0001", [dc], d);
    const again = await sendDirectPost("u1", "key-0001", [dc], d);
    expect(sent).toHaveLength(1);
    expect(again.results).toEqual([{ kind: "discord", label: dc.label, status: "sent", link: "https://discord.com/channels/g/c1/m1", error: null }]);
  });

  it("sends a new post with the same text when it is a new form", async () => {
    const { d, sent } = deps();
    await sendDirectPost("u1", "key-0001", [tg], d);
    await sendDirectPost("u1", "key-0002", [tg], d);
    expect(sent).toHaveLength(2);
  });

  it("keeps two people apart even when their forms use the same key", async () => {
    const { d, sent } = deps();
    await sendDirectPost("u1", "key-0001", [tg], d);
    await sendDirectPost("u2", "key-0001", [tg], d);
    expect(sent).toHaveLength(2);
    expect(await postIdFor("u1", "key-0001")).not.toBe(await postIdFor("u2", "key-0001"));
  });

  it("marks a refusal as failed and no answer as uncertain", async () => {
    const { d } = deps({ post: async (item) => { if (item.kind === "telegram") throw new Refused("Bad Request: chat not found"); throw new DOMException("timeout", "TimeoutError"); } });
    const out = await sendDirectPost("u1", "key-0001", [tg, dc], d);
    expect(out.results.map((r) => [r.kind, r.status])).toEqual([["telegram", "failed"], ["discord", "uncertain"]]);
    expect(out.results[1].error).toMatch(/may have been sent/);
  });

  it("refuses an empty choice and two messages for one place", async () => {
    const { d } = deps();
    await expect(sendDirectPost("u1", "key-0001", [], d)).rejects.toThrow(/at least one/);
    await expect(sendDirectPost("u1", "key-0001", [tg, tg], d)).rejects.toThrow(/one message/);
  });
});

describe("resendFailed", () => {
  it("resends a refused destination with the same text, and only once at a time", async () => {
    let fail = true;
    const { d, sent } = deps({ post: async (item) => { if (fail) throw new Refused("Missing Permissions"); sent.push(item); return { link: null }; } });
    await sendDirectPost("u1", "key-0001", [dc], d);
    fail = false;
    const [a, b] = await Promise.all([resendFailed("u1", await postIdFor("u1", "key-0001"), "discord", d), resendFailed("u1", await postIdFor("u1", "key-0001"), "discord", d)]);
    expect([a?.status, b]).toEqual(["sent", null]);
    expect(sent.map((s) => s.text)).toEqual([dc.text]);
  });

  it("never resends a destination that may already have landed, or someone else's", async () => {
    const { d } = deps({ post: async () => { throw new DOMException("timeout", "TimeoutError"); } });
    await sendDirectPost("u1", "key-0001", [dc], d);
    expect(await resendFailed("u1", await postIdFor("u1", "key-0001"), "discord", d)).toBeNull();
    expect(await resendFailed("u2", await postIdFor("u1", "key-0001"), "discord", d)).toBeNull();
  });
});

describe("shownStatus", () => {
  it("reads a claim with no result as uncertain once it is older than two minutes", () => {
    const at = new Date("2026-11-08T10:00:00Z");
    expect(shownStatus({ status: "pending", updatedAt: at }, new Date(at.getTime() + 60_000))).toBe("pending");
    expect(shownStatus({ status: "pending", updatedAt: at }, new Date(at.getTime() + PENDING_MS + 1))).toBe("uncertain");
  });
});
