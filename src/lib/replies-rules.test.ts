/**
 * @fileoverview Rules for a connected account, how an outbound row reads, send windows, and waiting, the account ceiling and the
 * sweeper.
 * The reply engine on PGlite with the real migrations (shared setup: src/test/replies-setup.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { rulesFor } from "./judge";
import { ACCOUNT_REPLY_LIMIT, HOUR, REPLIES_PER_ACCOUNT_HOUR, WINDOW_CLOSED, answer, deps, item, now, pass, recordInbound, shownDecision, store, windowOpen } from "@/test/replies-setup";
import type { ReplyDeps, Rule } from "@/test/replies-setup";

vi.mock("@/db", async () => { const { testDb } = await import("@/test/replies-db"); return { db: () => testDb, hasDatabase: () => true }; });

describe("rules for a connected account", () => {
  const rule: Rule = { id: "r-acc", kind: "guidance", text: "Never offer a discount.", channels: "all", accountIds: ["buffer-ch-1"], level: "block" };
  // Filters the rules per draft exactly as the production judge (judgeDrafts) does, so a rule the reply path hands over
  // but the judge would drop counts as skipped here too.
  const failing = () => vi.fn<NonNullable<ReplyDeps["judge"]>>(async (drafts: { slotId: string; network: string; channelId?: string }[], rules: Rule[]) =>
    new Map(drafts.filter((d) => rulesFor(rules, d.network, d.channelId).some((r) => r.id === "r-acc")).map((d) => [d.slotId, [{ ...pass("r-acc"), verdict: "fail" as const, quote: "50% off", reason: "x" }]])));

  it("judges a rule written for the account when the account is matched to it", async () => {
    const judge = failing();
    const { d } = deps({ rules: async () => [rule], judge, ruleAccount: async () => ({ id: "buffer-ch-1", candidates: ["buffer-ch-1"] }) });
    const one = await recordInbound(store, item());
    { const o = await answer(d, "u1", one.messageId, "public"); expect(o?.decision).toBe("held"); expect((await judge.mock.results[0].value).size).toBe(1); }
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("judges the rules of every account it could be when the match is unsure, never skipping them", async () => {
    const judge = failing();
    const { d } = deps({ rules: async () => [rule], judge, ruleAccount: async () => ({ candidates: ["buffer-ch-1", "buffer-ch-2"] }) });
    const one = await recordInbound(store, item());
    { const o = await answer(d, "u1", one.messageId, "public"); expect(o?.decision).toBe("held"); expect((await judge.mock.results[0].value).size).toBe(1); }
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("judges account rules when nothing says which account this is", async () => {
    const judge = failing();
    const { d } = deps({ rules: async () => [rule], judge });
    const one = await recordInbound(store, item());
    { const o = await answer(d, "u1", one.messageId, "public"); expect(o?.decision).toBe("held"); expect((await judge.mock.results[0].value).size).toBe(1); }
  });

  // A shared rule switched off for the network but switched back on for one account depends on the account too.
  const onForOne = (id: string): Rule => ({ id: "r-acc", kind: "guidance", text: "Never offer a discount.", channels: "all", except: ["instagram"], overrides: { accounts: { [id]: true } }, level: "block" });

  it("judges a shared rule switched on for this account, though it is off for the network", async () => {
    const judge = failing();
    const { d } = deps({ rules: async () => [onForOne("buffer-ch-1")], judge, ruleAccount: async () => ({ id: "buffer-ch-1", candidates: ["buffer-ch-1"] }) });
    const one = await recordInbound(store, item());
    expect((await answer(d, "u1", one.messageId, "public"))?.decision).toBe("held");
    expect(judge).toHaveBeenCalledTimes(1);
  });

  it("judges a rule switched on for an account it could be when the match is unsure", async () => {
    const judge = failing();
    const { d } = deps({ rules: async () => [onForOne("buffer-ch-2")], judge, ruleAccount: async () => ({ candidates: ["buffer-ch-1", "buffer-ch-2"] }) });
    const one = await recordInbound(store, item());
    expect((await answer(d, "u1", one.messageId, "public"))?.decision).toBe("held");
  });

  it("control: leaves out a rule switched on only for an account this cannot be", async () => {
    const judge = failing();
    const { d } = deps({ rules: async () => [onForOne("buffer-ch-9")], judge, ruleAccount: async () => ({ candidates: ["buffer-ch-1"] }) });
    const one = await recordInbound(store, item());
    expect((await answer(d, "u1", one.messageId, "public"))?.decision).toBe("sent");
    expect(judge).not.toHaveBeenCalled();
  });

  it("leaves out rules written for other accounts when this one is not in Buffer on that network", async () => {
    const judge = failing();
    const { d } = deps({ rules: async () => [rule], judge, ruleAccount: async () => ({ candidates: [] }) });
    const one = await recordInbound(store, item());
    expect((await answer(d, "u1", one.messageId, "public"))?.decision).toBe("sent");
    expect(judge).not.toHaveBeenCalled();
  });
});

describe("how an outbound row reads", () => {
  it("shows a call with no result as uncertain once it is old", () => {
    const started = new Date(now.getTime() - 3 * 60_000);
    expect(shownDecision({ decision: null, callStartedAt: started }, now)).toBe("uncertain");
    expect(shownDecision({ decision: null, callStartedAt: now }, now)).toBe("sending");
    expect(shownDecision({ decision: "sent", callStartedAt: started }, now)).toBe("sent");
  });
});

describe("send windows", () => {
  const at = (h: number) => new Date(now.getTime() - h * HOUR);
  it("gives a private reply 7 days from the comment and a DM 24 hours from the last message", () => {
    expect(windowOpen("instagram", "private", { commentAt: at(6 * 24), lastInboundAt: null }, now).open).toBe(true);
    expect(windowOpen("instagram", "private", { commentAt: at(8 * 24), lastInboundAt: null }, now)).toEqual({ open: false, reason: WINDOW_CLOSED });
    expect(windowOpen("instagram", "dm", { commentAt: at(1), lastInboundAt: at(23) }, now).open).toBe(true);
    expect(windowOpen("instagram", "dm", { commentAt: at(1), lastInboundAt: at(25) }, now).open).toBe(false);
  });
  it("has no window on Mastodon and Bluesky, and refuses networks it does not know", () => {
    expect(windowOpen("mastodon", "dm", { commentAt: at(9999), lastInboundAt: at(9999) }, now).open).toBe(true);
    expect(windowOpen("bluesky", "public", { commentAt: at(9999), lastInboundAt: null }, now).open).toBe(true);
    expect(windowOpen("myspace", "public", { commentAt: at(1), lastInboundAt: null }, now).open).toBe(false);
  });
});

describe("waiting, the account ceiling and the sweeper", () => {
  const wait = (seconds: number) => Object.assign(new Error("rate limited"), { refused: true, retryAfterSeconds: seconds });

  it("puts a reply the network asked to wait on back, and sends it once after the wait", async () => {
    const send = vi.fn<ReplyDeps["send"]>(async () => { throw wait(120); });
    const { d } = deps({ send, waitSeconds: (e) => (e as { retryAfterSeconds?: number }).retryAfterSeconds, channelInstance: undefined } as Partial<ReplyDeps>);
    const { messageId } = await recordInbound(store, item({ channelInstance: "ig-wait" }));
    expect(await answer(d, "u1", messageId, "public")).toBeNull();
    const [row] = await store.replies("u1", messageId);
    expect(row.decision).toBeNull();
    // Before the wait is over nothing is due; after it the sweeper finds it, and the second try sends.
    expect((await store.stalledReplies(new Date(now.getTime() + 60_000), 24 * HOUR, 10)).map((r) => r.inboundId)).not.toContain(messageId);
    const due = await store.stalledReplies(new Date(now.getTime() + 121_000), 24 * HOUR, 10);
    expect(due).toContainEqual({ userId: "u1", inboundId: messageId, route: "public", channel: "instagram", channelInstance: "ig-wait", automationId: null });
    const ok = deps({ now: () => new Date(now.getTime() + 121_000) });
    expect((await answer(ok.d, "u1", messageId, "public"))?.decision).toBe("sent");
    expect(ok.send).toHaveBeenCalledTimes(1);
  });

  it("never lists a reply whose call started, or one older than the age limit", async () => {
    const send = vi.fn<ReplyDeps["send"]>(async () => { throw new Error("socket hang up"); });
    const { d } = deps({ send });
    const { messageId: started } = await recordInbound(store, item({ channelInstance: "ig-sweep" }));
    await answer(d, "u1", started, "public");
    const due = await store.stalledReplies(new Date(now.getTime() + 10 * HOUR), 24 * HOUR, 50);
    expect(due.map((r) => r.inboundId)).not.toContain(started);
    expect(await store.stalledReplies(new Date(now.getTime() + 30 * HOUR), 24 * HOUR, 50)).toEqual([]);
  });

  it("holds every reply past the account's hourly ceiling, before drafting", async () => {
    const draft = vi.fn<ReplyDeps["draft"]>(async () => "Thanks!");
    const { d } = deps({ draft });
    for (let i = 0; i < REPLIES_PER_ACCOUNT_HOUR; i++) {
      const { messageId } = await recordInbound(store, item({ channelInstance: "ig-busy" }));
      expect((await answer(d, "u1", messageId, "public"))?.decision).toBe("sent");
    }
    const { messageId } = await recordInbound(store, item({ channelInstance: "ig-busy" }));
    expect(await answer(d, "u1", messageId, "public")).toMatchObject({ decision: "held", reason: ACCOUNT_REPLY_LIMIT });
    expect(draft).toHaveBeenCalledTimes(REPLIES_PER_ACCOUNT_HOUR);
  }, 60_000);

  it("finds this account's put-back replies even when other accounts have older ones waiting", async () => {
    const send = vi.fn<ReplyDeps["send"]>(async () => { throw wait(60); });
    const { d } = deps({ send, waitSeconds: (e) => (e as { retryAfterSeconds?: number }).retryAfterSeconds } as Partial<ReplyDeps>);
    for (let i = 0; i < 25; i++) {
      const { messageId } = await recordInbound(store, item({ channelInstance: "ig-noisy", at: new Date(now.getTime() - 2 * HOUR) }));
      await answer(d, "u1", messageId, "public");
    }
    const { messageId: mine } = await recordInbound(store, item({ channelInstance: "ig-quiet" }));
    await answer(d, "u1", mine, "public");
    const due = await store.stalledReplies(new Date(now.getTime() + 61_000), 24 * HOUR, 20, { userId: "u1", channel: "instagram", channelInstance: "ig-quiet" });
    expect(due.map((r) => r.inboundId)).toEqual([mine]);
  }, 60_000);
});
