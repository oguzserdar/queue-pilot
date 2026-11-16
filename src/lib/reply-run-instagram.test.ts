/**
 * @fileoverview The reply run with an Instagram account connected: Instagram's comments and messages arrive by webhook,
 * so the run makes no read call for it, while the other accounts are read as before. A reply the webhook queued is sent
 * once, privately for a comment; a throttle puts it back, a refused token marks the account broken, and a lost answer
 * is never sent again.
 * The reply run on PGlite with the real migrations, against fake Mastodon and Bluesky servers (src/test/reply-run-setup.ts).
 */
import { describe, expect, it, vi } from "vitest";
import { USER, get, net, outbound, pg, post, run, store } from "@/test/reply-run-setup";
import type { ReplyRunDeps } from "@/test/reply-run-setup";
import { encryptSecret } from "@/lib/secrets";
import { settingsKey } from "@/test/reply-run-db";

vi.mock("@/db", async () => { const { testDb } = await import("@/test/reply-run-db"); return { db: () => testDb, hasDatabase: () => true }; });

const addInstagram = async () => pg.query(
  `insert into qp_social_account (id, user_id, network, account_id, handle, server, credentials, replies_on) values ('run-ig-1', $1, 'instagram', '17841400000000001', 'ada.studio', 'https://graph.instagram.com', $2, true)`,
  [USER, encryptSecret(JSON.stringify({ token: "ig-token" }), settingsKey)],
);

describe("an Instagram account in the reply run", () => {
  it("is never read and never called, and the other accounts are still read", async () => {
    await addInstagram();
    const urls: string[] = [];
    const watchGet: NonNullable<ReplyRunDeps["get"]> = async (url, init) => { urls.push(String(url)); return get(url, init); };
    const watchPost: NonNullable<ReplyRunDeps["post"]> = async (url, init) => { urls.push(String(url)); return post(url, init); };

    const sum = await run({ get: watchGet, post: watchPost });

    expect(urls.filter((u) => /instagram\.com|facebook\.com/.test(u))).toEqual([]);
    expect(sum.accounts).toBe(3);
    expect([net.mastodonGets > 0, net.blueskyGets > 0]).toEqual([true, true]);
    const cursor = await pg.query(`select 1 from qp_reply_cursor where account_id = 'run-ig-1'`);
    expect(cursor.rows).toHaveLength(0);
  });
});

/** Records one Instagram comment and queues its private reply, as the webhook does. */
async function queuedComment(commentId = "c-1") {
  const recorded = await store.recordInbound({
    userId: USER, channel: "instagram", channelInstance: "run-ig-1", from: { value: "p-1", displayName: "pat" },
    threadKey: "post-1", externalId: commentId, kind: "comment", text: "Where can I get the guide?", at: new Date(net.now.getTime() - 60_000),
    postExternalId: "post-1", meta: { from: "p-1" },
  });
  await store.queueReply(USER, recorded.messageId, "private", net.now);
}

/** A post that answers Instagram's calls with `answer` and passes every other call to the fake servers. */
function instagramAnswers(answer: () => Promise<Response>) {
  const calls: { url: string; body: unknown }[] = [];
  const watched: NonNullable<ReplyRunDeps["post"]> = async (url, init) => {
    if (!String(url).startsWith("https://graph.instagram.com/")) return post(url, init);
    calls.push({ url: String(url), body: JSON.parse(String(init.body)) });
    return answer();
  };
  return { watched, calls };
}

describe("an Instagram reply the webhook queued", () => {
  it("is sent once, privately, to the comment", async () => {
    await addInstagram();
    await queuedComment();
    const { watched, calls } = instagramAnswers(async () => Response.json({ recipient_id: "p-1", message_id: "m-1" }));
    await run({ post: watched });
    await run({ post: watched });
    expect(calls).toEqual([{ url: "https://graph.instagram.com/v27.0/17841400000000001/messages", body: { recipient: { comment_id: "c-1" }, message: { text: "Thanks for asking!" } } }]);
    expect((await outbound()).filter((o) => o.channel === "instagram").map((o) => o.decision)).toEqual(["sent"]);
  });

  it("waits on a throttle, without sending, and is not marked failed", async () => {
    await addInstagram();
    await queuedComment();
    const usage = JSON.stringify({ x: [{ estimated_time_to_regain_access: 5 }] });
    const { watched, calls } = instagramAnswers(async () => Response.json({ error: { code: 80002, message: "throttled" } }, { status: 400, headers: { "x-business-use-case-usage": usage } }));
    await run({ post: watched });
    expect(calls).toHaveLength(1);
    expect((await outbound()).filter((o) => o.channel === "instagram").map((o) => o.decision)).not.toContain("failed");
  });

  it("marks the account broken when Instagram refuses its token", async () => {
    await addInstagram();
    await queuedComment();
    const { watched } = instagramAnswers(async () => Response.json({ error: { code: 190, message: "Invalid OAuth access token." } }, { status: 401 }));
    await run({ post: watched });
    const row = await pg.query<{ broken_at: Date | null }>(`select broken_at from qp_social_account where id = 'run-ig-1'`);
    expect(row.rows[0]?.broken_at).not.toBeNull();
  });

  it("never sends again when the answer was lost after the call left", async () => {
    await addInstagram();
    await queuedComment();
    const { watched, calls } = instagramAnswers(async () => { throw new Error("connection reset"); });
    await run({ post: watched });
    net.now = new Date(net.now.getTime() + 11 * 60_000);
    await run({ post: watched });
    expect(calls).toHaveLength(1);
  });
});
