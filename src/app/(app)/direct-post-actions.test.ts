/**
 * @fileoverview The post actions keep each person to their own posts and places: a follow-up only on one of their own
 * Buffer posts that has not gone out; a Discord channel only in their own server; follow-ups changed only on their
 * draft; a place the panel could not load is left as it is; a timer that does not start never loses or cancels a
 * saved post; and bad input gets a message, not a crash.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectPostDeps } from "@/lib/direct-posts";

const st = vi.hoisted(() => ({
  user: "u1" as string | null,
  posts: [] as { id: string; status: string; dueAt: string | null }[],
  timerFails: false,
  timers: [] as unknown[][],
  sent: [] as string[],
  store: null as unknown,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn<typeof import("next/cache").revalidatePath>() }));
vi.mock("@/lib/current-user", () => ({ signedInUserId: async () => st.user }));
vi.mock("@/lib/rate-limit", () => ({ limit: async () => ({ ok: true }) }));
vi.mock("@/lib/security-events", () => ({ recordAction: vi.fn<typeof import("@/lib/security-events").recordAction>() }));
vi.mock("@/lib/echo-run", () => ({ botTokens: async () => ({ telegram: "T", discord: "D" }) }));
vi.mock("@/lib/echo-store", () => ({
  postgresEchoStore: () => ({
    destinations: async (userId: string) => [
      { kind: "telegram", target: `chat-${userId}`, label: "News", guildId: null },
      { kind: "discord", target: "c1", label: "Server #news", guildId: `guild-${userId}` },
    ],
  }),
}));
vi.mock("@/lib/discord", async (orig) => ({
  ...(await orig<typeof import("@/lib/discord")>()),
  channelsWithAccess: async (_t: string, guildId: string) => (guildId === "guild-u1" ? [{ id: "c1", name: "news", canPost: true }, { id: "c2", name: "staff", canPost: false }] : [{ id: "x9", name: "other", canPost: true }]),
}));
// Each person's Mastodon and Bluesky accounts: u1 owns m1 (Mastodon), b1 (Bluesky) and gone1 (refused sign-in).
vi.mock("@/lib/social-accounts", () => {
  const all = [
    { userId: "u1", id: "m1", network: "mastodon", handle: "@ada@mastodon.example", server: "mastodon.example", credentials: {}, broken: false },
    { userId: "u1", id: "b1", network: "bluesky", handle: "ada.bsky.social", server: "bsky.social", credentials: {}, broken: false },
    { userId: "u1", id: "gone1", network: "mastodon", handle: "@old@mastodon.example", server: "mastodon.example", credentials: {}, broken: true },
    { userId: "u2", id: "m2", network: "mastodon", handle: "@bob@mastodon.example", server: "mastodon.example", credentials: {}, broken: false },
  ];
  return {
    readSocialAccount: async (userId: string, id: string) => all.find((a) => a.userId === userId && a.id === id) ?? null,
    listSocialAccounts: async (userId: string) => all.filter((a) => a.userId === userId).map(({ id, network, handle, server, broken }) => ({ id, network, handle, server, broken, repliesOn: false, connectedAt: "" })),
  };
});
vi.mock("@/lib/buffer/snapshot-store", () => ({ postgresSnapshotStore: () => ({ get: async () => ({ data: { posts: st.posts } }) }) }));
// The page read is the store's recent list in one page here; paging itself is tested on Postgres.
vi.mock("@/lib/direct-post-store", () => ({ postgresDirectPostStore: () => st.store, directPostPage: async (userId: string) => ({ rows: await (st.store as DirectPostDeps["store"]).recent(userId, 12), older: null, newer: null }) }));
vi.mock("@/lib/direct-post-run", () => ({
  directPostDeps: (): DirectPostDeps => ({ store: st.store as DirectPostDeps["store"], post: async (item) => (st.sent.push(item.kind), { link: null }), refused: () => false }),
  startTimerOrNote: async (...a: unknown[]) => { if (st.timerFails) return "Saved, but its timer did not start, so it may go out late, with the daily check."; st.timers.push(a); return undefined; },
}));

const { memoryDirectPostStore, followUpIdFor } = await import("@/lib/direct-posts");
const actions = await import("./direct-post-actions");
const later = () => new Date(Date.now() + 3 * 3_600_000).toISOString();

beforeEach(() => {
  st.user = "u1";
  st.posts = [{ id: "bp1", status: "scheduled", dueAt: later() }];
  st.timerFails = false;
  st.timers = [];
  st.sent = [];
  st.store = memoryDirectPostStore();
});

describe("saveFollowUpAction", () => {
  it("refuses a Buffer post that is not in the person's own week, or already went out", async () => {
    expect((await actions.saveFollowUpAction("someone-elses", { telegram: { text: "Hi" } })).ok).toBe(false);
    st.posts = [{ id: "bp1", status: "sent", dueAt: later() }];
    expect((await actions.saveFollowUpAction("bp1", { telegram: { text: "Hi" } })).ok).toBe(false);
    expect(await (st.store as ReturnType<typeof memoryDirectPostStore>).recent("u1", 5)).toEqual([]);
  });

  it("leaves a place the panel did not send as it is, and turns off a place sent as null", async () => {
    await actions.saveFollowUpAction("bp1", { telegram: { text: "Hi" }, discord: { channelId: "c1", text: "Hey" } });
    const id = await followUpIdFor("u1", "bp1");
    await actions.saveFollowUpAction("bp1", { telegram: { text: "Edited" } });
    let rows = await (st.store as ReturnType<typeof memoryDirectPostStore>).rows("u1", id);
    expect(rows.map((r) => [r.kind, r.status, r.text]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))).toEqual([["discord", "scheduled", "Hey"], ["telegram", "scheduled", "Edited"]]);
    await actions.saveFollowUpAction("bp1", { discord: null });
    rows = await (st.store as ReturnType<typeof memoryDirectPostStore>).rows("u1", id);
    expect(rows.find((r) => r.kind === "discord")?.status).toBe("cancelled");
  });

  it("says when a place could not be changed because it is going out now", async () => {
    await actions.saveFollowUpAction("bp1", { telegram: { text: "Hi" } });
    await (st.store as ReturnType<typeof memoryDirectPostStore>).claimDue(new Date(Date.now() + 4 * 3_600_000), 10);
    const r = await actions.saveFollowUpAction("bp1", { telegram: { text: "Too late" } });
    expect(r).toMatchObject({ ok: true, note: expect.stringMatching(/Telegram already went out or is going out now/) });
  });

  it("refuses a Discord channel outside the person's server", async () => {
    expect((await actions.saveFollowUpAction("bp1", { discord: { channelId: "x9", text: "Hi" } })).ok).toBe(false);
  });

  it("answers bad input with a message", async () => {
    expect((await actions.saveFollowUpAction("bp1", null as never)).ok).toBe(false);
  });
});

describe("sendPostAction with a time", () => {
  it("keeps the post saved when its timer does not start, and a retry with the same form stays scheduled", async () => {
    st.timerFails = true;
    const input = { key: "form-key-0001", sendAt: later(), telegram: { text: "Issue 41" } };
    const first = await actions.sendPostAction(input);
    expect(first).toMatchObject({ ok: true, note: expect.stringMatching(/may go out late/) });
    st.timerFails = false;
    const again = await actions.sendPostAction(input);
    expect(again.ok && again.results.map((r) => r.status)).toEqual(["scheduled"]);
  });

  it("refuses a Discord channel the bot cannot post in", async () => {
    const r = await actions.sendPostAction({ key: "form-key-0002", discord: { channelId: "c2", text: "Hi" } });
    expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/cannot post in #staff/) });
    expect(st.sent).toEqual([]);
  });
});

describe("follow-ups in Sources", () => {
  it("cannot be changed, cancelled or resent there", async () => {
    await actions.saveFollowUpAction("bp1", { telegram: { text: "Hi" } });
    const id = await followUpIdFor("u1", "bp1");
    expect(await actions.changeScheduledPostAction(id, { telegram: "Changed" })).toMatchObject({ ok: false, message: expect.stringMatching(/follows a Buffer post/) });
    expect(await actions.cancelScheduledPostAction(id)).toMatchObject({ ok: false, message: expect.stringMatching(/follows a Buffer post/) });
    expect((await actions.resendPostAction(id, "telegram")).ok).toBe(false);
  });

  it("shows which rows follow a Buffer post", async () => {
    await actions.saveFollowUpAction("bp1", { telegram: { text: "Hi" } });
    expect((await actions.recentDirectPosts()).rows.map((r) => r.followsBuffer)).toEqual([true]);
  });
});

describe("another person's post", () => {
  it("cannot be changed or cancelled, and no timer starts", async () => {
    const { postId } = await (async () => {
      const r = await actions.sendPostAction({ key: "form-key-0003", sendAt: later(), telegram: { text: "Mine" } });
      if (!r.ok) throw new Error(r.message);
      return { postId: (await (st.store as ReturnType<typeof memoryDirectPostStore>).recent("u1", 1))[0].postId };
    })();
    st.timers = [];
    st.user = "u2";
    expect((await actions.changeScheduledPostAction(postId, { telegram: "Theirs" })).ok).toBe(false);
    expect((await actions.cancelScheduledPostAction(postId)).ok).toBe(false);
    expect(st.timers).toEqual([]);
    expect((await (st.store as ReturnType<typeof memoryDirectPostStore>).rows("u1", postId))[0]).toMatchObject({ text: "Mine", status: "scheduled" });
  });

  it("answers a change with no change object with a message", async () => {
    expect((await actions.changeScheduledPostAction("x", null as never)).ok).toBe(false);
  });
});

describe("posting to Mastodon and Bluesky accounts", () => {
  it("lists the person's own accounts as places, leaving out one whose sign-in was refused", async () => {
    const t = await actions.postTargets();
    expect(t.accounts?.map((a) => a.id)).toEqual(["m1", "b1"]);
    expect(t.accounts?.find((a) => a.id === "b1")?.limit).toBe(300);
  });

  it("sends to the person's own Mastodon and Bluesky accounts with no Buffer post behind it", async () => {
    const r = await actions.sendPostAction({ key: "k-social-1", accounts: [{ id: "m1", text: "Out now." }, { id: "b1", text: "Out now." }] });
    expect(r.ok).toBe(true);
    expect(st.sent).toEqual(["mastodon", "bluesky"]);
  });

  it("control: refuses another person's account and sends nothing", async () => {
    const r = await actions.sendPostAction({ key: "k-social-2", accounts: [{ id: "m2", text: "Hi" }] });
    expect(r).toEqual({ ok: false, message: "That account is not connected to Queue Pilot. Connect it in Settings, Channels." });
    expect(st.sent).toEqual([]);
  });

  it("refuses an account whose sign-in was refused, and text over Bluesky's 300", async () => {
    expect((await actions.sendPostAction({ key: "k-social-3", accounts: [{ id: "gone1", text: "Hi" }] })).ok).toBe(false);
    const long = await actions.sendPostAction({ key: "k-social-4", accounts: [{ id: "b1", text: "x".repeat(301) }] });
    expect(long).toEqual({ ok: false, message: "The Bluesky message is 301 characters; Bluesky takes up to 300." });
    expect(st.sent).toEqual([]);
  });
});
