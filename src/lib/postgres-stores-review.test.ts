/**
 * @fileoverview The Postgres stores on real Postgres (PGLite with every migration): review links, comment checks, account routing and approval confirmations.
 * Split from postgres-stores.test.ts; the shared database setup is src/test/postgres-stores-setup.ts.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { pg, seedPeople, testDb } from "@/test/postgres-stores-setup";

// The production stores run their exact Drizzle queries against the test database.
vi.mock("../db", () => ({ db: () => testDb, schema: {} }));

const { deleteAccount } = await import("./delete-account");
const { postgresRulesStore } = await import("./rules-store");
const { checkComment, postgresReviewStore, reviewNotes, MAX_COMMENTS: MAX_REVIEW_COMMENTS, MAX_OPEN_LINKS, TooManyLinksError } = await import("./review-store");

beforeAll(seedPeople);
afterAll(async () => { await pg.close(); });

describe("review links on real Postgres", () => {
  const drafts = [
    { postId: "p1", network: "twitter", channel: "OguzSerdar", dueAt: "2026-11-03T09:00:00Z", text: "Day 4 of Queue Pilot: reviews." },
    { postId: "p2", network: "linkedin", channel: "Oguz", dueAt: null, text: "Shipping review links today." },
  ];

  it("shares drafts under an unguessable link that only its owner can turn off", async () => {
    const s = postgresReviewStore();
    const link = await s.create("u7", drafts);
    expect(link.id).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect((await s.open(link.id))?.drafts).toEqual(drafts);
    await s.revoke("u8", link.id);
    expect(await s.open(link.id)).not.toBeNull();
    await s.revoke("u7", link.id);
    expect(await s.open(link.id)).toBeNull();
    expect((await s.list("u7")).find((l) => l.id === link.id)?.revokedAt).not.toBeNull();
  });

  it("turns a link back on for its owner only, keeps its comments and reopens an expired one for 7 days", async () => {
    const s = postgresReviewStore();
    const link = await s.create("u7", drafts);
    await s.revoke("u7", link.id);
    expect(await s.reopen("u8", link.id)).toBe(false);
    expect(await s.open(link.id)).toBeNull();
    expect(await s.reopen("u7", link.id)).toBe(true);
    expect((await s.open(link.id))?.expiresAt).toBe(link.expiresAt);
    expect(await s.reopen("u7", link.id)).toBe(false);
    await pg.query(`update qp_review_link set revoked_at = now(), expires_at = now() - interval '1 day' where id = $1`, [link.id]);
    expect(await s.reopen("u7", link.id)).toBe(true);
    const reopened = await s.open(link.id);
    expect(Date.parse(reopened!.expiresAt ?? "") - Date.now()).toBeGreaterThan(6.9 * 86_400_000);
    await s.revoke("u7", link.id);
  });

  it("refuses to turn a link back on past the number a person can keep on", async () => {
    const s = postgresReviewStore();
    await pg.query(`insert into "user" (id, name, email) values ('u10', 'u10', 'u10@x')`);
    const off = await s.create("u10", drafts.slice(0, 1));
    await s.revoke("u10", off.id);
    const on = await Promise.all(Array.from({ length: MAX_OPEN_LINKS }, () => s.create("u10", drafts.slice(0, 1))));
    await expect(s.reopen("u10", off.id)).rejects.toBeInstanceOf(TooManyLinksError);
    await Promise.all(on.map((l) => s.revoke("u10", l.id)));
  });

  it("takes comments while the link is on, and none after it is turned off", async () => {
    const s = postgresReviewStore();
    const link = await s.create("u7", drafts);
    const ok = checkComment(drafts, { postId: "p1", name: "Ali", text: "just say QP", start: 9, end: 20 });
    if (!ok.ok) throw new Error(ok.message);
    expect(ok.comment.quote).toBe("Queue Pilot");
    expect(await s.comment(link.id, ok.comment)).toBe(true);
    expect((await s.open(link.id))?.comments).toMatchObject([{ postId: "p1", name: "Ali", text: "just say QP", quote: "Queue Pilot", start: 9, end: 20 }]);
    await s.revoke("u7", link.id);
    expect(await s.comment(link.id, ok.comment)).toBe(false);
  });

  it("stops at the comment limit for one link", async () => {
    const s = postgresReviewStore();
    const link = await s.create("u7", drafts);
    const c = { postId: "p2", name: "Spam", text: "x", quote: null, start: null, end: null };
    for (let i = 0; i < MAX_REVIEW_COMMENTS; i++) await s.comment(link.id, c);
    expect(await s.comment(link.id, c)).toBe(false);
    expect((await s.open(link.id))?.comments).toHaveLength(MAX_REVIEW_COMMENTS);
    await s.revoke("u7", link.id);
  });

  it("refuses a new link past the number a person can keep on", async () => {
    const s = postgresReviewStore();
    const mine = await Promise.all(Array.from({ length: MAX_OPEN_LINKS }, () => s.create("u8", drafts.slice(0, 1))));
    await expect(s.create("u8", drafts.slice(0, 1))).rejects.toBeInstanceOf(TooManyLinksError);
    await s.revoke("u8", mine[0].id);
    await expect(s.create("u8", drafts.slice(0, 1))).resolves.toBeTruthy();
  });

  it("goes with the person's account", async () => {
    const s = postgresReviewStore();
    await pg.query(`insert into "user" (id, name, email) values ('u9', 'u9', 'u9@x')`);
    const link = await s.create("u9", drafts);
    await s.comment(link.id, { postId: "p1", name: "Ali", text: "hi", quote: null, start: null, end: null });
    await deleteAccount("u9");
    expect(await s.open(link.id)).toBeNull();
    const { rows } = await pg.query<{ n: number }>(`select count(*)::int as n from qp_review_comment where link_id = '${link.id}'`);
    expect(rows[0].n).toBe(0);
  });
});

describe("checkComment and reviewNotes", () => {
  const drafts = [{ postId: "p1", network: "twitter", channel: "X", dueAt: null, text: "Day 4 of Queue Pilot." }];
  it("takes the quote from the shared text, never from the reviewer", () => {
    const r = checkComment(drafts, { postId: "p1", name: " Ali ", text: " shorter ", start: 9, end: 20 });
    expect(r).toEqual({ ok: true, comment: { postId: "p1", name: "Ali", text: "shorter", quote: "Queue Pilot", start: 9, end: 20 } });
  });
  it("refuses an unknown draft, a missing name or comment, and a highlight outside the text", () => {
    expect(checkComment(drafts, { postId: "p9", name: "A", text: "x" }).ok).toBe(false);
    expect(checkComment(drafts, { postId: "p1", name: " ", text: "x" }).ok).toBe(false);
    expect(checkComment(drafts, { postId: "p1", name: "A", text: "" }).ok).toBe(false);
    expect(checkComment(drafts, { postId: "p1", name: "A", text: "x", start: 5, end: 99 }).ok).toBe(false);
    expect(checkComment(drafts, { postId: "p1", name: "A", text: "x", start: 5, end: 5 }).ok).toBe(false);
    expect(checkComment(drafts, { postId: "p1", name: "A", text: "x", start: 1.5, end: 3 }).ok).toBe(false);
    expect(checkComment(drafts, { postId: "p1", name: "A".repeat(61), text: "x" }).ok).toBe(false);
  });
  it("turns comments into notes on their drafts, naming highlighted words", () => {
    const posts = reviewNotes([{ id: "L", drafts, createdAt: "2026-10-31T00:00:00Z", revokedAt: null, comments: [
      { id: "c1", postId: "p1", name: "Ali", text: "just say QP", quote: "Queue Pilot", start: 9, end: 20, createdAt: "2026-10-31T01:00:00Z" },
      { id: "c2", postId: "p1", name: "Sara", text: "Nice", quote: null, start: null, end: null, createdAt: "2026-10-31T02:00:00Z" },
    ] }]);
    expect(posts).toEqual([{ id: "L:p1", network: "twitter", text: "Day 4 of Queue Pilot.", notes: [
      { text: 'On the words "Queue Pilot": just say QP', by: "Ali", at: "2026-10-31T01:00:00Z" },
      { text: "Nice", by: "Sara", at: "2026-10-31T02:00:00Z" },
    ] }]);
  });
});

describe("account routing and review boundaries", () => {
  it("keeps accounts separate, restores saved exceptions and rejects another owner's targets", async () => {
    const { setRuleOverride, setInheritance } = await import("./rule-routing-store");
    const { resolveRule } = await import("./rule-scopes");
    const channels = [{ id: "route-company", name: "Company", service: "linkedin" }, { id: "route-personal", name: "Personal", service: "linkedin" }];
    await pg.query(`insert into buffer_snapshot(user_id,data,fetched_at) values ('u7',$1,now()) on conflict(user_id) do update set data=excluded.data,fetched_at=excluded.fetched_at`, [JSON.stringify({ channels, posts: [] })]);
    const s = postgresRulesStore();
    const shared = await s.add("u7", { kind: "guidance", text: "Routing test", channels: "all", level: "warn" });
    const local = await s.add("u7", { kind: "guidance", text: "Company only", channels: "all", accountIds: ["route-company"], level: "warn" });
    await expect(s.add("u8", { kind: "guidance", text: "Foreign", channels: "all", accountIds: ["route-company"], level: "warn" })).rejects.toThrow(/connected/);
    expect(await setRuleOverride("u8", shared, { level: "network", id: "linkedin" }, false)).toBe(false);
    expect(await setRuleOverride("u7", shared, { level: "account", id: "foreign" }, false)).toBe(false);
    expect(await setRuleOverride("u7", local, { level: "account", id: "route-personal" }, true)).toBe(false);
    expect(await setRuleOverride("u7", shared, { level: "network", id: "linkedin" }, false)).toBe(true);
    expect(await setRuleOverride("u7", shared, { level: "account", id: "route-personal" }, true)).toBe(true);
    let rule = (await s.list("u7")).find(r => r.id === shared)!;
    expect(resolveRule(rule, "linkedin", "route-company").applies).toBe(false);
    expect(resolveRule(rule, "linkedin", "route-personal").applies).toBe(true);
    expect(await setInheritance("u7", { level: "account", id: "route-personal" }, false, false)).toBe(true);
    rule = (await s.list("u7")).find(r => r.id === shared)!;
    expect(resolveRule(rule, "linkedin", "route-personal").applies).toBe(false);
    await setInheritance("u7", { level: "account", id: "route-personal" }, true, true);
    rule = (await s.list("u7")).find(r => r.id === shared)!;
    expect(resolveRule(rule, "linkedin", "route-personal").applies).toBe(true);
    expect(resolveRule(rule, "linkedin", "route-company").applies).toBe(false);
    expect(await setInheritance("u8", { level: "account", id: "route-personal" }, false, false)).toBe(false);
  });
  it("expired review links cannot be read or commented on, and revocation requires the owner", async () => {
    const s = postgresReviewStore();
    const link = await s.create("u7", [{ postId: "expiry-post", channelId: "route-company", channel: "Company", network: "linkedin", text: "Monday", dueAt: null }], 1);
    expect(await s.revoke("u8", link.id)).toBe(false);
    expect(await s.revoke("u7", "nonexistent")).toBe(false);
    const comment = { postId: "expiry-post", name: "Reviewer", text: "Tuesday", quote: null, start: null, end: null };
    expect(await s.comment(link.id, { ...comment, postId: "unshared" })).toBe(false);
    await pg.query(`update qp_review_link set expires_at=now()-interval '1 second' where id=$1`, [link.id]);
    expect(await s.open(link.id)).toBeNull();
    expect(await s.comment(link.id, comment)).toBe(false);
    expect(await s.revoke("u7", link.id)).toBe(true);
    expect(await s.revoke("u7", link.id)).toBe(false);
  });
});

describe("approval confirmations on Postgres", () => {
  it("claims a token exactly once under concurrent requests and scopes release to its owner", async () => {
    const { claimApproval, releaseApproval } = await import("./agent-permission");
    const expires = Date.now() + 60_000;
    const results = await Promise.all([claimApproval("u1", "approval-test", expires), claimApproval("u1", "approval-test", expires)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await releaseApproval("u2", "approval-test");
    expect(await claimApproval("u1", "approval-test", expires)).toBe(false);
    await releaseApproval("u1", "approval-test");
    expect(await claimApproval("u1", "approval-test", expires)).toBe(true);
  });
  it("changes the permission revision even for consecutive saves", async () => {
    const { approvePermission, setApproveMode } = await import("./agent-permission");
    const revisions = [];
    for (const mode of ["ask", "off", "ask"] as const) {
      await setApproveMode("u1", mode);
      revisions.push((await approvePermission("u1")).revision);
    }
    expect(new Set(revisions).size).toBe(3);
  });
});
