/**
 * @fileoverview Sending a reply once under racing workers, storing inbound items once, holding a reply with its reason, and
 * replying privately once per person per post.
 * The reply engine on PGlite with the real migrations (shared setup: src/test/replies-setup.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { HOUR, REPLY_CLAIM_MS, REPLY_PURPOSE, WINDOW_CLOSED, answer, deps, item, now, pass, pg, recordInbound, store } from "@/test/replies-setup";
import type { ReplyDeps, Rule, Verdict } from "@/test/replies-setup";

vi.mock("@/db", async () => { const { testDb } = await import("@/test/replies-db"); return { db: () => testDb, hasDatabase: () => true }; });

describe("sending a reply once", () => {
  it("lets only one of two racing workers send", async () => {
    const { d, send } = deps();
    const { messageId } = await recordInbound(store, item());
    const results = await Promise.all([answer(d, "u1", messageId, "public"), answer(d, "u1", messageId, "public")]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(results.filter((r) => r?.decision === "sent")).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect((await store.replies("u1", messageId)).map((r) => r.decision)).toEqual(["sent"]);
  });

  it("never resends a reply that may have landed, even after the claim runs out", async () => {
    const send = vi.fn<ReplyDeps["send"]>(async () => { throw new Error("socket hang up"); });
    const { d } = deps({ send });
    const { messageId } = await recordInbound(store, item());
    const first = await answer(d, "u1", messageId, "public");
    expect(first?.decision).toBe("uncertain");
    const later = deps({ now: () => new Date(now.getTime() + REPLY_CLAIM_MS + 60_000) });
    expect(await answer(later.d, "u1", messageId, "public")).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    expect(later.send).not.toHaveBeenCalled();
  });

  it("does not send when the claim was taken over before the call", async () => {
    const { messageId } = await recordInbound(store, item());
    const ctx = (await store.inbound("u1", messageId))!;
    const dead = await store.claim("u1", ctx, "public", ctx.conversationId, now);
    expect(dead).not.toBeNull();
    // A live claim is not taken over.
    expect(await store.claim("u1", ctx, "public", ctx.conversationId, now)).toBeNull();
    const { d, send } = deps({ now: () => new Date(now.getTime() + REPLY_CLAIM_MS + 1) });
    expect((await answer(d, "u1", messageId, "public"))?.decision).toBe("sent");
    // The first worker wakes up after the takeover: its fence refuses it.
    expect(await store.startCall("u1", dead!.id, dead!.token, "late", now)).toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("sends a reply that passes the rules, once, with the evidence on the row", async () => {
    const rule: Rule = { id: "r-ok", kind: "guidance", text: "Be kind.", channels: "all", level: "block" };
    const { d, send } = deps({ rules: async () => [rule] });
    const { messageId } = await recordInbound(store, item());
    const out = await answer(d, "u1", messageId, "public");
    expect(out).toMatchObject({ decision: "sent", text: "Thanks! It is in the shop link in my bio." });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ route: "public", replyToExternalId: expect.stringMatching(/^c-/), key: out!.id });
    expect(await answer(d, "u1", messageId, "public")).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    const [row] = await store.replies("u1", messageId);
    expect(row).toMatchObject({ decision: "sent", direction: "out", kind: "public" });
    expect(row.externalId).toMatch(/^out-/);
    expect(row.callStartedAt).not.toBeNull();
  });
});

describe("storing inbound", () => {
  it("stores the same webhook or poll item once", async () => {
    const x = item();
    const [a, b] = await Promise.all([recordInbound(store, x), recordInbound(store, x)]);
    const c = await recordInbound(store, x);
    expect(new Set([a.messageId, b.messageId, c.messageId]).size).toBe(1);
    expect([a.created, b.created, c.created].filter(Boolean)).toHaveLength(1);
    const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from qp_message where external_id = $1`, [x.externalId]);
    expect(rows[0].n).toBe(1);
  });

  it("finds the same person again on the same account, and keeps workspaces apart", async () => {
    const one = await recordInbound(store, item({ from: { value: "same-person" } }));
    const two = await recordInbound(store, item({ from: { value: "same-person" } }));
    expect(two.contactId).toBe(one.contactId);
    const other = await recordInbound(store, item({ userId: "u2", from: { value: "same-person" }, externalId: "shared-id" }));
    const otherAgain = await recordInbound(store, item({ userId: "u1", from: { value: "same-person" }, externalId: "shared-id" }));
    expect(other.contactId).not.toBe(one.contactId);
    expect(otherAgain.contactId).toBe(one.contactId);
    expect(otherAgain.created).toBe(true);
    expect(await store.inbound("u2", one.messageId)).toBeNull();
  });

  it("moves the conversation's last inbound time forward only", async () => {
    const early = new Date(now.getTime() - 3 * HOUR);
    const late = new Date(now.getTime() - HOUR);
    const base = { kind: "dm" as const, threadKey: "dm-forward", from: { value: "dm-forward" }, postExternalId: null };
    await recordInbound(store, item({ ...base, at: late }));
    const r = await recordInbound(store, item({ ...base, at: early }));
    expect((await store.inbound("u1", r.messageId))!.lastInboundAt).toEqual(late);
  });
});

describe("holding a reply", () => {
  it("holds a reply a rule stops, naming the rule, and sends nothing", async () => {
    const rule: Rule = { id: "r-price", kind: "banned", phrases: ["shop"], text: 'Never "shop".', channels: "all", level: "block" };
    const { d, send } = deps({
      rules: async () => [rule],
      judge: async (drafts) => new Map([[drafts[0].slotId, [{ ruleId: "r-price", rule: 'Never "shop".', level: "block", verdict: "fail", probability: 0.99, quote: "shop", reason: "It uses the banned word." } satisfies Verdict]]]),
    });
    const { messageId } = await recordInbound(store, item());
    const out = await answer(d, "u1", messageId, "public");
    expect(out?.decision).toBe("held");
    expect(out?.reason).toContain('Never "shop".');
    expect(send).not.toHaveBeenCalled();
    const [row] = await store.replies("u1", messageId);
    expect(row).toMatchObject({ decision: "held", text: "Thanks! It is in the shop link in my bio." });
    expect(row.reason).toContain('Never "shop".');
  });

  it("holds when the judge cannot run, or is unsure, or there is no AI", async () => {
    const rule: Rule = { id: "r-x", kind: "guidance", text: "No prices.", channels: "all", level: "warn" };
    const cases: Partial<ReplyDeps>[] = [
      { judge: async () => { throw new Error("timeout"); } },
      { judge: async (drafts) => new Map([[drafts[0].slotId, [{ ...pass("r-x"), verdict: "unsure", reason: "Not sure." }]]]) },
      { judge: async () => new Map() },
      { judge: null },
    ];
    for (const c of cases) {
      const { d, send } = deps({ rules: async () => [rule], ...c });
      const { messageId } = await recordInbound(store, item());
      const out = await answer(d, "u1", messageId, "public");
      expect(out?.decision).toBe("held");
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("does not ask the judge when no rule applies to the network", async () => {
    const rule: Rule = { id: "r-li", kind: "guidance", text: "LinkedIn only.", channels: ["linkedin"], level: "block" };
    const judge = vi.fn<NonNullable<ReplyDeps["judge"]>>();
    const { d, send } = deps({ rules: async () => [rule], judge });
    const { messageId } = await recordInbound(store, item());
    expect((await answer(d, "u1", messageId, "public"))?.decision).toBe("sent");
    expect(judge).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("holds with 'window closed' when the DM window has passed", async () => {
    const draft = vi.fn<ReplyDeps["draft"]>(async () => "Hi");
    const { d, send } = deps({ draft });
    const { messageId } = await recordInbound(store, item({ kind: "dm", threadKey: "dm-old", postExternalId: null, at: new Date(now.getTime() - 25 * HOUR) }));
    const out = await answer(d, "u1", messageId, "dm");
    expect(out).toMatchObject({ decision: "held", reason: WINDOW_CLOSED });
    expect(send).not.toHaveBeenCalled();
    expect(draft).not.toHaveBeenCalled();
  });

  it("never sends to a person who opted out, even when it arrives while drafting", async () => {
    const before = item({ from: { value: "quiet-1" } });
    await store.addOptOut("u1", "quiet-1", "instagram", REPLY_PURPOSE, now);
    const { d, send } = deps();
    const a = await recordInbound(store, before);
    expect((await answer(d, "u1", a.messageId, "public"))?.reason).toMatch(/opted out/);

    const during = item({ from: { value: "quiet-2" } });
    const b = await recordInbound(store, during);
    const late = deps({ draft: async () => { await store.addOptOut("u1", "quiet-2", "instagram", "all", now); return "Hi"; } });
    expect((await answer(late.d, "u1", b.messageId, "public"))?.reason).toMatch(/opted out/);
    expect(send).not.toHaveBeenCalled();
    expect(late.send).not.toHaveBeenCalled();
  });
});

describe("reply privately once per person per post", () => {
  it("does not answer a second comment by the same person on the same post privately", async () => {
    const { d, send } = deps();
    const first = await recordInbound(store, item({ from: { value: "fan" } }));
    const second = await recordInbound(store, item({ from: { value: "fan" } }));
    expect((await answer(d, "u1", first.messageId, "private"))?.decision).toBe("sent");
    const out = await answer(d, "u1", second.messageId, "private");
    expect(out).toMatchObject({ decision: "held", reason: "Already replied privately to this person on this post." });
    expect(send).toHaveBeenCalledTimes(1);
    // The public reply is a separate route and conversation.
    expect((await answer(d, "u1", second.messageId, "public"))?.decision).toBe("sent");
    const [priv] = await store.replies("u1", first.messageId);
    expect(priv.conversationId).not.toBe((await store.inbound("u1", first.messageId))!.conversationId);
  });

  it("gives the claim back when nothing was sent", async () => {
    const refused = Object.assign(new Error("not allowed"), { refused: true });
    const a = deps({ send: vi.fn<ReplyDeps["send"]>(async () => { throw refused; }) });
    const first = await recordInbound(store, item({ from: { value: "fan-2" } }));
    const second = await recordInbound(store, item({ from: { value: "fan-2" } }));
    expect((await answer(a.d, "u1", first.messageId, "private"))?.decision).toBe("failed");
    const b = deps();
    expect((await answer(b.d, "u1", second.messageId, "private"))?.decision).toBe("sent");
  });

  it("a run whose claim was taken over cannot give back the live run's claim", async () => {
    let release!: () => void;
    const stalled = new Promise<void>((r) => { release = r; });
    const rule: Rule = { id: "r-any", kind: "guidance", text: "Be kind.", channels: "all", level: "block" };
    // A: stalls while drafting, then its judge fails, so it lands on a hold after B has sent.
    const a = deps({ rules: async () => [rule], draft: async () => { await stalled; return "Hi"; }, judge: async () => { throw new Error("timeout"); } });
    const first = await recordInbound(store, item({ from: { value: "fan-4" } }));
    const running = answer(a.d, "u1", first.messageId, "private");
    await vi.waitFor(async () => expect(await store.replies("u1", first.messageId)).toHaveLength(1));
    // B: after A's claim ran out, takes it over and sends.
    const b = deps({ now: () => new Date(now.getTime() + REPLY_CLAIM_MS + 1) });
    expect((await answer(b.d, "u1", first.messageId, "private"))?.decision).toBe("sent");
    release();
    expect(await running).toBeNull();
    const second = await recordInbound(store, item({ from: { value: "fan-4" } }));
    expect((await answer(b.d, "u1", second.messageId, "private"))?.reason).toBe("Already replied privately to this person on this post.");
    expect(b.send).toHaveBeenCalledTimes(1);
    expect(a.send).not.toHaveBeenCalled();
  });

  it("keeps the claim when the reply may have landed", async () => {
    const a = deps({ send: vi.fn<ReplyDeps["send"]>(async () => { throw new Error("timeout"); }) });
    const first = await recordInbound(store, item({ from: { value: "fan-3" } }));
    const second = await recordInbound(store, item({ from: { value: "fan-3" } }));
    expect((await answer(a.d, "u1", first.messageId, "private"))?.decision).toBe("uncertain");
    const b = deps();
    expect((await answer(b.d, "u1", second.messageId, "private"))?.decision).toBe("held");
    expect(b.send).not.toHaveBeenCalled();
  });
});
