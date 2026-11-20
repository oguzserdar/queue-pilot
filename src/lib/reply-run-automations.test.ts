/**
 * @fileoverview Automations in the reply run, once per person per post, held automation replies, the send check while a reply is
 * written, and waiting replies the owner's later changes rule out.
 * The reply run on PGlite with the real migrations, against fake Mastodon and Bluesky servers (src/test/reply-run-setup.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { M, USER, addAccount, later, net, pg, post, run, setReplies, statusesPosted } from "@/test/reply-run-setup";

vi.mock("@/db", async () => { const { testDb } = await import("@/test/reply-run-db"); return { db: () => testDb, hasDatabase: () => true }; });

describe("automations on an account", () => {
  const save = async (over: Record<string, unknown> = {}) => {
    const { saveAutomation } = await import("./reply-automation-store");
    const r = await saveAutomation(USER, { accountId: M, name: "Guide", post: { scope: "any" }, keywords: ["guide"], replyMode: "fixed", replyTexts: ["Sent you the guide!"], link: "https://ada.example/guide", ...over });
    if (!r.ok) throw new Error(JSON.stringify(r));
    return r.id;
  };

  it("answers only the mentions an automation matches, with its fixed text and the link; the rest reach the inbox unanswered", async () => {
    await run();
    await save();
    later();
    net.notes = [{ id: "60", acct: "bob@far.example", text: "can I get the GUIDE?" }, { id: "61", acct: "cat@far.example", text: "nice post" }];
    const sum = await run();
    expect(sum.recorded).toBe(2);
    expect(statusesPosted).toHaveLength(1);
    expect(statusesPosted[0].status).toBe("@bob@far.example Sent you the guide! https://ada.example/guide");
    const out = (await pg.query<{ automation_id: string | null }>(`select automation_id from qp_message where direction = 'out'`)).rows;
    expect(out).toHaveLength(1);
    expect(out[0].automation_id).toMatch(/^auto_/);
  });

  it("holds a voice reply that leaves out the automation's link, and gives the drafter the link", async () => {
    await run();
    await save({ replyMode: "voice", replyTexts: [] });
    later();
    net.notes = [{ id: "62", acct: "bob@far.example", text: "guide please" }];
    const seen: unknown[] = [];
    const sum = await run({ draft: async (req) => { seen.push(req); return "Here it is!"; } });
    expect(seen[0]).toMatchObject({ link: "https://ada.example/guide" });
    expect(statusesPosted).toHaveLength(0);
    expect(sum.held).toBe(1);
  });

  it("sends nothing when the automation is switched off while the reply is written", async () => {
    await run();
    const id = await save({ replyMode: "voice", replyTexts: [] });
    later();
    net.notes = [{ id: "63", acct: "bob@far.example", text: "guide?" }];
    const { saveAutomation } = await import("./reply-automation-store");
    await run({ draft: async () => {
      await saveAutomation(USER, { id, accountId: M, name: "Guide", active: false, post: { scope: "any" }, keywords: ["guide"], replyMode: "voice", replyTexts: [], link: "https://ada.example/guide" });
      return "Here: https://ada.example/guide";
    } });
    expect(statusesPosted).toHaveLength(0);
  });
});

describe("automations, once per person per post", () => {
  const save = async (over: Record<string, unknown> = {}) => {
    const { saveAutomation } = await import("./reply-automation-store");
    const r = await saveAutomation(USER, { accountId: M, name: "Guide", post: { scope: "any" }, keywords: ["guide"], replyMode: "fixed", replyTexts: ["Sent you the guide!"], link: null, ...over });
    if (!r.ok) throw new Error(JSON.stringify(r));
  };

  it("answers one person once on one post, however many times they comment the keyword", async () => {
    await run();
    await save();
    later();
    net.notes = [{ id: "90", acct: "bob@far.example", text: "guide?", inReplyTo: "111" }, { id: "91", acct: "bob@far.example", text: "guide pls", inReplyTo: "111" }, { id: "92", acct: "bob@far.example", text: "guide", inReplyTo: "222" }];
    await run();
    expect(statusesPosted.map((s) => s.in_reply_to_id).sort()).toEqual(["s90", "s92"]);
  });

  it("matches a one-post automation saved with the post's link, as people paste it", async () => {
    await run();
    await save({ post: { scope: "post", externalId: "https://m.example/@run/111" } });
    later();
    net.notes = [{ id: "93", acct: "bob@far.example", text: "guide?", inReplyTo: "111" }, { id: "94", acct: "cat@far.example", text: "guide?", inReplyTo: "333" }];
    await run();
    expect(statusesPosted.map((s) => s.in_reply_to_id)).toEqual(["s93"]);
  });
});

describe("an automation reply that was held", () => {
  it("leaves the person free to get an answer on that post next time", async () => {
    const { saveAutomation } = await import("./reply-automation-store");
    await run();
    const r = await saveAutomation(USER, { accountId: M, name: "Guide", post: { scope: "any" }, keywords: ["guide"], replyMode: "voice", replyTexts: [], link: "https://ada.example/guide" });
    if (!r.ok) throw new Error("not saved");
    later();
    net.notes = [{ id: "95", acct: "bob@far.example", text: "guide?", inReplyTo: "111" }];
    // The draft leaves the link out, so the reply is held and nothing is sent.
    expect((await run({ draft: async () => "Here it is!" })).held).toBe(1);
    later();
    net.notes = [{ id: "96", acct: "bob@far.example", text: "guide again?", inReplyTo: "111" }];
    await run({ draft: async () => "Here: https://ada.example/guide" });
    expect(statusesPosted.map((st) => st.in_reply_to_id)).toEqual(["s96"]);
  });
});

describe("the send check, while a reply is written", () => {
  it("sends nothing when replies are turned off and on again meanwhile", async () => {
    await run();
    later();
    net.notes = [{ id: "97", acct: "bob@far.example", text: "q" }];
    await run({ draft: async () => {
      await setReplies(USER, M, false, net.now);
      net.now = new Date(net.now.getTime() + 1000);
      await setReplies(USER, M, true, net.now);
      return "Thanks for asking!";
    } });
    expect(statusesPosted).toHaveLength(0);
  });

  it("sends nothing when the automation is moved to another account meanwhile", async () => {
    const { saveAutomation } = await import("./reply-automation-store");
    await addAccount("run-mastodon-2", "mastodon", "acc-other", "@other@m.example", "https://m.example", false);
    await run();
    const input = { accountId: M, name: "Guide", post: { scope: "any" }, keywords: ["guide"], replyMode: "voice", replyTexts: [], link: null };
    const r = await saveAutomation(USER, input);
    if (!r.ok) throw new Error("not saved");
    later();
    net.notes = [{ id: "98", acct: "bob@far.example", text: "guide?" }];
    await run({ draft: async () => {
      await saveAutomation(USER, { ...input, id: r.id, accountId: "run-mastodon-2" });
      return "Here you go!";
    } });
    expect(statusesPosted).toHaveLength(0);
  });
});

describe("waiting replies the owner's later changes rule out", () => {
  const busyOnce = () => {
    let busy = true;
    const p: typeof post = async (url, init) => {
      if (busy && url.toString().endsWith("/api/v1/statuses")) { busy = false; return Response.json({ error: "slow down" }, { status: 429, headers: { "retry-after": "1" } }); }
      return post(url, init);
    };
    return p;
  };
  const decisions = async () => (await pg.query<{ decision: string | null; reason: string | null }>(`select decision, reason from qp_message where direction = 'out'`)).rows;

  it("does not send a waiting voice reply once an automation now decides what is answered", async () => {
    const { saveAutomation } = await import("./reply-automation-store");
    await run();
    later();
    net.notes = [{ id: "120", acct: "bob@far.example", text: "nice post" }];
    const p = busyOnce();
    await run({ post: p });
    expect(await decisions()).toEqual([{ decision: null, reason: null }]);
    await saveAutomation(USER, { accountId: M, name: "Guide", post: { scope: "any" }, keywords: ["guide"], replyMode: "voice", replyTexts: [], link: null });
    later();
    net.notes = [];
    await run({ post: p });
    expect(statusesPosted).toHaveLength(0);
    expect((await decisions())[0].decision).toBe("held");
  });

  it("settles a waiting reply whose automation was deleted, so it never takes a retry slot again", async () => {
    const { saveAutomation, deleteAutomation } = await import("./reply-automation-store");
    await run();
    const r = await saveAutomation(USER, { accountId: M, name: "Guide", post: { scope: "any" }, keywords: ["guide"], replyMode: "fixed", replyTexts: ["Sent!"], link: null });
    if (!r.ok) throw new Error("not saved");
    later();
    net.notes = [{ id: "121", acct: "bob@far.example", text: "guide?" }];
    const p = busyOnce();
    await run({ post: p });
    await deleteAutomation(USER, r.id);
    later();
    net.notes = [];
    await run({ post: p });
    expect(statusesPosted).toHaveLength(0);
    expect((await decisions())[0].decision).toBe("held");
  });
});
