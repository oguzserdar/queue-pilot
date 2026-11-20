/**
 * @fileoverview Shared setup for the reply-run tests (reply-run-*.test.ts): fake Mastodon and Bluesky servers at the
 * network edge, the run's clock, a test account owner with one account on each network, and the hooks that reset them
 * before each test. Each test file mocks "@/db" with the PGlite database from reply-run-db.ts.
 */
import { encryptSecret } from "@/lib/secrets";
import { runReplies, type ReplyRunDeps } from "@/lib/reply-run";
import { postgresReplyStore } from "@/lib/reply-store";
import { postgresReplyCursorStore } from "@/lib/reply-cursor-store";
import { replyAccounts, ownAccounts, setReplies, markAccountBroken } from "@/lib/social-accounts";
import { replyPrompt } from "@/lib/reply-drafter";
import { tidFor } from "@/lib/bluesky";
import type { DraftRequest } from "@/lib/replies";
import type { Verdict } from "@/lib/judge";
import type { Rule } from "@/lib/rules";
import { afterAll, beforeAll, beforeEach, vi } from "vitest";
import { pg, settingsKey } from "./reply-run-db";

export { pg, setReplies, replyPrompt, tidFor };
export type { ReplyRunDeps, DraftRequest, Rule };

export const USER = "run-u1";
export const M = "run-mastodon-1";
export const B = "run-bluesky-1";
export const OWN_DID = "did:plc:runada";
export const OTHER_OWN_DID = "did:plc:runadatwo";
export const store = postgresReplyStore();
export const cursors = postgresReplyCursorStore();

// ---------- a fake Mastodon instance (https://m.example) ----------

export type Note = { id: string; acct: string; accountId?: string; text: string; visibility?: string; at?: string; inReplyTo?: string };
export let statusesPosted: Record<string, string>[] = [];

export function notification(n: Note) {
  return {
    id: n.id, type: "mention",
    status: {
      id: `s${n.id}`, account: { id: n.accountId ?? `acc-${n.acct}`, acct: n.acct }, content: `<p>${n.text}</p>`,
      url: `https://m.example/@x/s${n.id}`, created_at: n.at ?? clock().toISOString(), visibility: n.visibility ?? "public", in_reply_to_id: n.inReplyTo ?? null,
    },
  };
}

/** Mastodon's paging: min_id gives the page just after it, newest first; no cursor gives the newest page. */
export function mastodonList(url: URL): Response {
  net.mastodonGets += 1;
  const minId = url.searchParams.get("min_id");
  const limit = Number(url.searchParams.get("limit"));
  const sorted = [...net.notes].sort((a, b) => Number(a.id) - Number(b.id));
  const page = minId ? sorted.filter((n) => Number(n.id) > Number(minId)).slice(0, limit) : sorted.slice(-limit);
  page.reverse();
  const headers = page.length ? { link: `<https://m.example/api/v1/notifications?min_id=${page[0].id}>; rel="prev"` } : undefined;
  return Response.json(page.map(notification), { headers });
}

// ---------- a fake Bluesky PDS (https://pds.example) ----------

export type Bnote = { uri: string; did: string; handle?: string; text: string; reason?: string; root?: { uri: string; cid: string }; at?: string };
export let records: { rkey: string; record: Record<string, unknown> }[] = [];

/**
 * What the fake servers hold and the run's clock. Tests assign these, so they live on one object: a module's own
 * bindings cannot be assigned from the test files that import them.
 */
export const net = {
  notes: [] as Note[],
  /** Newest first, like the server. */
  bnotes: [] as Bnote[],
  mastodonGets: 0,
  blueskyGets: 0,
  /** Replaces the listing for one test (cursor-handling cases). */
  blueskyPage: null as ((cursor: string | null) => { notifications: Bnote[]; cursor?: string }) | null,
  now: new Date("2026-11-15T09:00:00Z"),
};

export function blueskyList(url: URL): Response {
  net.blueskyGets += 1;
  if (net.blueskyGets > 25) throw new Error("the run kept paging");
  const cursor = url.searchParams.get("cursor");
  const limit = Number(url.searchParams.get("limit"));
  const page = net.blueskyPage ? net.blueskyPage(cursor) : (() => {
    const start = cursor ? Number(cursor) : 0;
    const items = net.bnotes.slice(start, start + limit);
    return { notifications: items, cursor: start + limit < net.bnotes.length ? String(start + limit) : undefined };
  })();
  return Response.json({
    cursor: page.cursor,
    notifications: page.notifications.map((n) => ({
      uri: n.uri, cid: `cid-${n.uri}`, author: { did: n.did, handle: n.handle ?? `${n.did.slice(8)}.bsky.social` }, reason: n.reason ?? "mention",
      record: { text: n.text, ...(n.root ? { reply: { root: n.root, parent: n.root } } : {}) }, isRead: false, indexedAt: n.at ?? clock().toISOString(),
    })),
  });
}

export const get: NonNullable<ReplyRunDeps["get"]> = async (url) => {
  if (url.origin === "https://m.example" && url.pathname === "/api/v1/notifications") return mastodonList(url);
  if (url.origin === "https://pds.example" && url.pathname === "/xrpc/app.bsky.notification.listNotifications") return blueskyList(url);
  throw new Error(`Unexpected GET ${url}`);
};

export const post: NonNullable<ReplyRunDeps["post"]> = async (url, init) => {
  const body = JSON.parse(init.body);
  if (url.toString() === "https://m.example/api/v1/statuses") {
    statusesPosted.push(body);
    return Response.json({ id: `r${statusesPosted.length}`, url: null });
  }
  if (url.toString() === "https://pds.example/xrpc/com.atproto.server.createSession") return Response.json({ did: OWN_DID, accessJwt: "jwt" });
  if (url.toString() === "https://pds.example/xrpc/com.atproto.repo.createRecord") {
    records.push({ rkey: body.rkey, record: body.record });
    return Response.json({ uri: `at://${OWN_DID}/app.bsky.feed.post/${body.rkey}`, cid: "c" });
  }
  throw new Error(`Unexpected POST ${url}`);
};

// ---------- the run ----------

export const clock = () => net.now;
/** Moves past every network's minimum gap between reads. */
export const later = () => { net.now = new Date(net.now.getTime() + 11 * 60_000); };
export const pass = (ruleId: string): Verdict => ({ ruleId, rule: "r", level: "block", verdict: "pass", probability: 1, quote: "", reason: "" });

export function deps(over: Partial<ReplyRunDeps> = {}): ReplyRunDeps {
  return {
    store, cursors, accounts: replyAccounts, own: ownAccounts,
    draft: async () => "Thanks for asking!",
    rules: async () => [],
    judge: () => async (drafts, rules) => new Map(drafts.map((d) => [d.slotId, rules.map((r) => pass(r.id))])),
    markBroken: markAccountBroken,
    get, post, now: clock,
    ...over,
  };
}
export const run = (over: Partial<ReplyRunDeps> = {}) => runReplies(deps(over));

export async function addAccount(id: string, network: "mastodon" | "bluesky", networkAccountId: string, handle: string, server: string, on = true) {
  const credentials = network === "mastodon" ? { token: "t" } : { identifier: handle, appPassword: "app-pass" };
  await pg.query(
    `insert into qp_social_account (id, user_id, network, account_id, handle, server, credentials, replies_on) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, USER, network, networkAccountId, handle, server, encryptSecret(JSON.stringify(credentials), settingsKey), on],
  );
}

beforeAll(async () => {
  await pg.query(`insert into "user" (id, name, email) values ($1, 'Ada', 'ada@run.example')`, [USER]);
});

beforeEach(async () => {
  for (const t of ["qp_message", "qp_conversation", "qp_contact_identifier", "qp_contact", "qp_reply_cursor", "qp_social_account", "qp_cooldown"]) await pg.query(`delete from ${t}`);
  net.notes = []; net.bnotes = []; statusesPosted = []; records = []; net.mastodonGets = 0; net.blueskyGets = 0; net.blueskyPage = null;
  net.now = new Date("2026-11-15T09:00:00Z");
  await addAccount(M, "mastodon", "100", "@ada@m.example", "https://m.example");
  await addAccount(B, "bluesky", OWN_DID, "ada.bsky.social", "https://pds.example");
});

afterAll(async () => {
  await pg.close();
  vi.unstubAllEnvs();
});

export const outbound = async () => (await pg.query<{ decision: string; reason: string | null; text: string; channel: string }>(`select decision, reason, text, channel from qp_message where direction = 'out' order by updated_at, id`)).rows;
export const inboundCount = async () => Number((await pg.query<{ n: string }>(`select count(*) as n from qp_message where direction = 'in'`)).rows[0].n);
