/**
 * @fileoverview A place that follows a Buffer post: it goes out once Buffer has published the post, waits while Buffer
 * has not, follows a later time, gives up with the reason when the post failed, was deleted or is a day late, reads
 * Buffer once per post however many places follow it, and the automatic copy stands down for that post.
 */
import { describe, expect, it } from "vitest";
import { followUpIdFor, memoryDirectPostStore, nextBufferCheck, runDue, type BufferState, type DirectPostDeps, type PostItem } from "./direct-posts";

const DUE = new Date("2026-11-09T18:00:00Z");
const AT = new Date(DUE.getTime() + 60_000);
const tg: PostItem = { kind: "telegram", target: "-100", label: "News", text: "New post is up." };
const dc: PostItem = { kind: "discord", target: "c1", label: "QP #news", text: "New post is up on X.", guildId: "g1" };
const plus = (t: Date, ms: number) => new Date(t.getTime() + ms);

function setup(states: BufferState[]) {
  let now = new Date("2026-11-09T10:00:00Z");
  const sent: string[] = [];
  let reads = 0;
  const d: DirectPostDeps = {
    store: memoryDirectPostStore(),
    post: async (item) => (sent.push(`${item.kind}:${item.text}`), { link: null }),
    refused: () => false,
    bufferCheck: async () => states[Math.min(reads++, states.length - 1)],
    now: () => now,
  };
  return { d, sent, reads: () => reads, at: (t: Date) => (now = t) };
}

describe("following a Buffer post", () => {
  it("sends each place once Buffer has published, reading Buffer once for both places", async () => {
    const { d, sent, reads, at } = setup([{ state: "sent" }]);
    const id = await followUpIdFor("u1", "bp1");
    await d.store.follow("u1", id, tg, AT, new Date(), "bp1");
    await d.store.follow("u1", id, dc, AT, new Date(), "bp1");
    at(plus(AT, 1_000));
    await runDue(d);
    expect(sent.sort()).toEqual(["discord:New post is up on X.", "telegram:New post is up."]);
    expect(reads()).toBe(1);
    expect(await d.store.followedBufferPosts("u1", ["bp1", "bp2"])).toEqual(new Set(["bp1"]));
  });

  it("waits while Buffer has not published, then sends", async () => {
    const { d, sent, at } = setup([{ state: "waiting", dueAt: DUE }, { state: "sent" }]);
    await d.store.follow("u1", await followUpIdFor("u1", "bp1"), tg, AT, new Date(), "bp1");
    at(plus(AT, 1_000));
    const [first] = await runDue(d);
    expect(first.status).toBe("scheduled");
    expect(first.next).toEqual(plus(AT, 1_000 + 5 * 60_000));
    expect(sent).toEqual([]);
    at(plus(first.next!, 1_000));
    await runDue(d);
    expect(sent).toHaveLength(1);
  });

  it("follows a later time when the post was moved in Buffer", () => {
    const moved = plus(DUE, 3_600_000);
    expect(nextBufferCheck({ state: "waiting", dueAt: moved }, plus(AT, 1_000))).toEqual(plus(moved, 60_000));
  });

  it("checks every 5 minutes for 2 hours, then hourly, and gives up after a day", () => {
    expect(nextBufferCheck({ state: "waiting", dueAt: DUE }, plus(DUE, 3_600_000))).toEqual(plus(DUE, 3_600_000 + 5 * 60_000));
    expect(nextBufferCheck({ state: "waiting", dueAt: DUE }, plus(DUE, 3 * 3_600_000))).toEqual(plus(DUE, 4 * 3_600_000));
    expect(nextBufferCheck({ state: "waiting", dueAt: DUE }, plus(DUE, 25 * 3_600_000))).toBeNull();
    expect(nextBufferCheck({ state: "busy" }, DUE)).toEqual(plus(DUE, 5 * 60_000));
  });

  it("sends nothing and says why when the post failed or was deleted in Buffer", async () => {
    const { d, sent, at } = setup([{ state: "gone", reason: "The post was deleted in Buffer, so this was not sent." }]);
    await d.store.follow("u1", await followUpIdFor("u1", "bp1"), tg, AT, new Date(), "bp1");
    at(plus(AT, 1_000));
    const [r] = await runDue(d);
    expect(sent).toEqual([]);
    expect(r).toMatchObject({ status: "failed", error: "The post was deleted in Buffer, so this was not sent." });
  });

  it("sends nothing for a place turned off before the time, and the new text for one edited", async () => {
    const { d, sent, at } = setup([{ state: "sent" }]);
    const id = await followUpIdFor("u1", "bp1");
    await d.store.follow("u1", id, tg, AT, new Date(), "bp1");
    await d.store.follow("u1", id, dc, AT, new Date(), "bp1");
    await d.store.unfollow("u1", id, "telegram", new Date());
    await d.store.follow("u1", id, { ...dc, text: "Edited." }, AT, new Date(), "bp1");
    at(plus(AT, 1_000));
    await runDue(d);
    expect(sent).toEqual(["discord:Edited."]);
  });

  it("leaves a place that already went out as it is", async () => {
    const { d, at } = setup([{ state: "sent" }]);
    const id = await followUpIdFor("u1", "bp1");
    await d.store.follow("u1", id, tg, AT, new Date(), "bp1");
    at(plus(AT, 1_000));
    await runDue(d);
    expect(await d.store.follow("u1", id, { ...tg, text: "Again" }, AT, new Date(), "bp1")).toBe(false);
  });
});
