/**
 * @fileoverview Shared setup for the reply engine tests (replies-*.test.ts): fresh inbound items, the clock, and reply
 * deps whose sender counts calls. Each test file mocks "@/db" with the PGlite database from replies-db.ts.
 */
import { afterAll, beforeAll, vi } from "vitest";
import { postgresReplyStore, REPLY_CLAIM_MS, type InboundItem } from "@/lib/reply-store";
import { answer, recordInbound, shownDecision, windowOpen, REPLY_PURPOSE, WINDOW_CLOSED, REPLIES_PER_ACCOUNT_HOUR, ACCOUNT_REPLY_LIMIT, type ReplyDeps, type SendRequest } from "@/lib/replies";
import type { Verdict } from "@/lib/judge";
import type { Rule } from "@/lib/rules";
import { pg } from "./replies-db";

export { pg, REPLY_CLAIM_MS, answer, recordInbound, shownDecision, windowOpen, REPLY_PURPOSE, WINDOW_CLOSED, REPLIES_PER_ACCOUNT_HOUR, ACCOUNT_REPLY_LIMIT };
export type { ReplyDeps, InboundItem, SendRequest, Rule, Verdict };

export const now = new Date("2026-11-14T12:00:00Z");
export const store = postgresReplyStore();
let seq = 0;

/** A fresh comment or DM; every call gets its own external id unless one is given. */
export function item(over: Partial<InboundItem> = {}): InboundItem {
  seq += 1;
  return {
    userId: "u1", channel: "instagram", channelInstance: "ig-1", from: { value: `person-${seq}`, displayName: "Ana" },
    threadKey: "post-1", externalId: `c-${seq}`, kind: "comment", text: "Where can I buy the cookbook?", at: new Date(now.getTime() - HOUR),
    postExternalId: "post-1", ...over,
  };
}
export const HOUR = 3_600_000;

export const pass = (ruleId: string): Verdict => ({ ruleId, rule: "r", level: "block", verdict: "pass", probability: 1, quote: "", reason: "" });

/** Deps whose sender counts calls; the judge passes every rule unless replaced. */
export function deps(over: Partial<ReplyDeps> = {}) {
  const send = vi.fn<ReplyDeps["send"]>(async (_req: SendRequest) => ({ externalId: `out-${Math.random()}` }));
  const d: ReplyDeps = {
    store,
    draft: async () => "Thanks! It is in the shop link in my bio.",
    rules: async () => [],
    judge: async (drafts, rules) => new Map(drafts.map((x) => [x.slotId, rules.map((r) => pass(r.id))])),
    send,
    refused: (e) => (e as { refused?: boolean })?.refused === true,
    now: () => now,
    ...over,
  };
  return { d, send: (over.send as typeof send | undefined) ?? send };
}

beforeAll(async () => {
  await pg.query(`insert into "user" (id, name, email) values ('u1', 'a', 'a@x'), ('u2', 'b', 'b@x')`);
});
afterAll(async () => { await pg.close(); });
