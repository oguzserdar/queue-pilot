/**
 * @fileoverview Scheduled direct posts: sent once at their time, never after a cancel, with the edited text and time,
 * never by a timer set before an edit; a claim a dead worker left before calling is sent later, a call that got no
 * answer is never sent again, and rows written by the previous version keep their meaning.
 */
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { CLAIM_MS, PENDING_MS, memoryDirectPostStore, postIdFor, runDue, scheduleDirectPost, sendTimeProblem, sentLate, shownStatus, type DirectPostDeps, type PostItem } from "./direct-posts";

const tg: PostItem = { kind: "telegram", target: "-100", label: "Pennyrow news", text: "Patch 1.4 ships at 18:00." };
const dc: PostItem = { kind: "discord", target: "c1", label: "QP test #announcements", text: "Patch 1.4 ships at 18:00 today." };
const T0 = new Date("2026-11-08T10:00:00Z");
const AT = new Date("2026-11-08T18:00:00Z");

function setup() {
  let now = T0;
  const sent: PostItem[] = [];
  const d: DirectPostDeps = {
    store: memoryDirectPostStore(),
    post: async (item) => (sent.push(item), { link: null }),
    refused: () => false,
    now: () => now,
  };
  return { d, sent, at: (t: Date) => (now = t) };
}
const plus = (t: Date, ms: number) => new Date(t.getTime() + ms);

describe("scheduled direct posts", () => {
  it("sends nothing before its time and each place once at its time, however often the check runs", async () => {
    const { d, sent, at } = setup();
    await scheduleDirectPost("u1", "form-0001", [tg, dc], AT, d);
    expect(await runDue(d)).toEqual([]);
    at(plus(AT, 1_000));
    await Promise.all([runDue(d), runDue(d), runDue(d)]);
    await runDue(d);
    expect(sent.map((s) => s.kind).sort()).toEqual(["discord", "telegram"]);
  });

  it("sends nothing after a cancel", async () => {
    const { d, sent, at } = setup();
    const { postId } = await scheduleDirectPost("u1", "form-0001", [tg], AT, d);
    expect(await d.store.cancel("u1", postId, T0)).toBe(1);
    at(plus(AT, 60_000));
    await runDue(d);
    expect(sent).toEqual([]);
    expect((await d.store.rows("u1", postId))[0].status).toBe("cancelled");
  });

  it("sends the edited text, at the new time only", async () => {
    const { d, sent, at } = setup();
    const { postId } = await scheduleDirectPost("u1", "form-0001", [tg], AT, d);
    const later = plus(AT, 3_600_000);
    await d.store.reschedule("u1", postId, { sendAt: later, texts: { telegram: "Patch 1.4 ships at 19:00." } }, T0);
    at(plus(AT, 1_000));
    await runDue(d);
    expect(sent).toEqual([]);
    at(plus(later, 1_000));
    await runDue(d);
    expect(sent.map((s) => s.text)).toEqual(["Patch 1.4 ships at 19:00."]);
  });

  it("a timer set before an edit or a cancel sends nothing", async () => {
    const { d, sent, at } = setup();
    const { postId, revision } = await scheduleDirectPost("u1", "form-0001", [tg], AT, d);
    await d.store.reschedule("u1", postId, { texts: { telegram: "Edited." } }, T0);
    at(plus(AT, 1_000));
    expect(await runDue(d, { only: { postId, revision } })).toEqual([]);
    expect(sent).toEqual([]);
    await runDue(d, { only: { postId, revision: revision + 1 } });
    expect(sent.map((s) => s.text)).toEqual(["Edited."]);
  });

  it("sends a claim later when the worker died before calling Telegram or Discord", async () => {
    const { d, sent, at } = setup();
    await scheduleDirectPost("u1", "form-0001", [tg], AT, d);
    at(plus(AT, 1_000));
    expect(await d.store.claimDue(plus(AT, 1_000), 10)).toHaveLength(1); // claimed, then the worker dies
    await runDue(d);
    expect(sent).toEqual([]);
    at(plus(AT, CLAIM_MS + 2_000));
    await runDue(d);
    expect(sent).toHaveLength(1);
  });

  it("never sends again a call that got no answer, and shows it as may have been sent", async () => {
    const { d, sent, at } = setup();
    let hang = true;
    d.post = async (item) => { if (hang) throw new DOMException("timeout", "TimeoutError"); sent.push(item); return { link: null }; };
    const { postId } = await scheduleDirectPost("u1", "form-0001", [tg], AT, d);
    at(plus(AT, 1_000));
    await runDue(d);
    hang = false;
    at(plus(AT, CLAIM_MS + PENDING_MS + 5_000));
    await runDue(d);
    expect(sent).toEqual([]);
    const row = (await d.store.rows("u1", postId))[0];
    expect(row.status).toBe("uncertain");
  });

  it("marks a post that went out more than five minutes late", async () => {
    const { d, at } = setup();
    const { postId } = await scheduleDirectPost("u1", "form-0001", [tg], AT, d);
    at(plus(AT, 3 * 3_600_000)); // the timer was lost; the daily sweep sends it
    await runDue(d);
    expect(sentLate((await d.store.rows("u1", postId))[0])).toBe(true);
  });

  it("refuses a time in the past or more than 60 days ahead", () => {
    expect(sendTimeProblem(plus(T0, -60_000), T0)).toMatch(/future/);
    expect(sendTimeProblem(plus(T0, 61 * 86_400_000), T0)).toMatch(/60 days/);
    expect(sendTimeProblem(AT, T0)).toBeNull();
  });

  it("keeps two people's posts apart", async () => {
    const { d } = setup();
    const a = await scheduleDirectPost("u1", "form-0001", [tg], AT, d);
    const b = await scheduleDirectPost("u2", "form-0001", [tg], AT, d);
    expect(a.postId).not.toBe(b.postId);
    expect(await d.store.cancel("u2", a.postId, T0)).toBe(0);
  });
});

describe("rows from the previous version", () => {
  it("keeps the id the previous version gave the same form, so a retry across a deploy sends nothing new", async () => {
    const old = createHash("sha256").update("qp-announcement|u1|form-0001").digest("base64url");
    expect(await postIdFor("u1", "form-0001")).toBe(old);
  });

  it("reads a pending row with no claim marks as a started call: may have been sent, never resent", () => {
    const row = { status: "pending" as const, updatedAt: T0, callStartedAt: null, claimedUntil: null };
    expect(shownStatus(row, plus(T0, 60_000))).toBe("pending");
    expect(shownStatus(row, plus(T0, PENDING_MS + 1))).toBe("uncertain");
  });
});
