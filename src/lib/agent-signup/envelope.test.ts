import { describe, expect, it } from "vitest";
import {
  AGENT_ERRORS,
  DELETE_AFTER_FREEZE_MS,
  FREEZE_AFTER_MS,
  accountBlock,
  agentError,
  agentReply,
  dropsCredential,
  lifecycle,
  type AgentErrorCode,
} from "./envelope";

const H = 60 * 60 * 1000;
const D = 24 * H;
const created = new Date("2026-11-14T10:00:00.000Z");
const at = (ms: number) => new Date(created.getTime() + ms);
const freezeAt = at(72 * H);
const deleteAt = at(72 * H + 30 * D);

describe("lifecycle", () => {
  it("freezes 72 hours after sign-up and deletes 30 days after the freeze, not after sign-up", () => {
    expect(FREEZE_AFTER_MS).toBe(72 * H);
    expect(DELETE_AFTER_FREEZE_MS).toBe(30 * D);
    const l = lifecycle(created, null, created);
    expect(l.freezeAt).toEqual(freezeAt);
    expect(l.deleteAt).toEqual(deleteAt);
    expect(l.deleteAt!.toISOString()).toBe("2026-12-17T10:00:00.000Z");
  });

  it("is active one millisecond before 72 hours and frozen exactly at 72 hours", () => {
    expect(lifecycle(created, null, at(72 * H - 1)).state).toBe("active");
    expect(lifecycle(created, null, freezeAt).state).toBe("frozen");
  });

  it("is frozen one millisecond before delete_at and deleted exactly at it", () => {
    expect(lifecycle(created, null, new Date(deleteAt.getTime() - 1)).state).toBe("frozen");
    expect(lifecycle(created, null, deleteAt).state).toBe("deleted");
  });

  it("a claim before the freeze keeps it active with no deadlines", () => {
    expect(lifecycle(created, at(H), at(100 * D))).toEqual({ state: "active", claimed: true, freezeAt: null, deleteAt: null });
  });

  it("a claim after the freeze unfreezes it", () => {
    expect(lifecycle(created, at(80 * H), at(81 * H))).toEqual({ state: "active", claimed: true, freezeAt: null, deleteAt: null });
  });

  it("a claim stamped at or after delete_at does not bring a deleted account back", () => {
    expect(lifecycle(created, deleteAt, at(40 * D)).state).toBe("deleted");
  });
});

describe("the account block", () => {
  const base = { id: "reg_1", createdAt: created, claimedAt: null, claimUrl: "https://qp.example/claim/ct_x.k.m", claimedBy: null };

  it("carries the claim link and both deadlines while unclaimed", () => {
    expect(accountBlock({ ...base, now: at(H) })).toEqual({
      id: "reg_1",
      state: "unclaimed",
      claimed: false,
      claim_url: base.claimUrl,
      freeze_at: freezeAt.toISOString(),
      delete_at: deleteAt.toISOString(),
      claimed_by: null,
    });
  });

  it("still offers the link while frozen", () => {
    const b = accountBlock({ ...base, now: freezeAt });
    expect(b.state).toBe("frozen");
    expect(b.claim_url).toBe(base.claimUrl);
  });

  it("drops the link once deleted", () => {
    const b = accountBlock({ ...base, now: deleteAt });
    expect(b).toMatchObject({ state: "deleted", claimed: false, claim_url: null });
  });

  it("after a claim: claimed, who claimed it, no link, no deadlines", () => {
    expect(accountBlock({ ...base, claimedAt: at(H), claimedBy: "j***@e*****.com", now: at(2 * H) })).toEqual({
      id: "reg_1",
      state: "claimed",
      claimed: true,
      claim_url: null,
      freeze_at: null,
      delete_at: null,
      claimed_by: "j***@e*****.com",
    });
  });
});

describe("every reply carries account", () => {
  const block = accountBlock({ id: "reg_1", createdAt: created, claimedAt: null, claimUrl: "https://qp.example/claim/x", claimedBy: null, now: at(H) });

  it("on success", () => {
    expect(agentReply({ saved: true }, block)).toEqual({ saved: true, account: block });
  });

  it("on success with the caller unknown it is present and null", () => {
    const r = agentReply({ ok: 1 }, null);
    expect(r).toHaveProperty("account", null);
  });

  it("cannot be overwritten by the body", () => {
    expect(agentReply({ account: "spoofed" }, block).account).toBe(block);
  });

  it.each(Object.keys(AGENT_ERRORS) as AgentErrorCode[])("on error %s, with or without a known caller", (code) => {
    expect(agentError(code, { account: block, traceId: "tr_1" }).body).toHaveProperty("account", block);
    expect(agentError(code, { account: null, traceId: "tr_1" }).body).toHaveProperty("account", null);
  });
});

describe("errors", () => {
  it("use the contract's flat shape", () => {
    const block = accountBlock({ id: "reg_1", createdAt: created, claimedAt: null, claimUrl: "https://qp.example/claim/x", claimedBy: null, now: freezeAt });
    const e = agentError("account_frozen", { account: block, traceId: "tr_abc" });
    expect(e.status).toBe(403);
    expect(e.body).toEqual({
      error: "account_frozen",
      error_description: expect.any(String),
      origin: "request",
      retryable: false,
      next: { action: "show_claim_url", say: expect.stringContaining("https://qp.example/claim/x"), url: "https://qp.example/claim/x" },
      trace_id: "tr_abc",
      account: block,
    });
  });

  it("send retry_after in the body and as a header when given", () => {
    const e = agentError("rate_limited", { account: null, traceId: "tr_1", retryAfter: 42 });
    expect(e.body.retry_after).toBe(42);
    expect(e.headers["Retry-After"]).toBe("42");
    expect(e.body.retryable).toBe(true);
  });

  it("only invalid_grant, account_deleted and agent_revoked tell the agent to drop its credential", () => {
    const dropping = (Object.keys(AGENT_ERRORS) as AgentErrorCode[]).filter(dropsCredential).sort();
    expect(dropping).toEqual(["account_deleted", "agent_revoked", "invalid_grant"]);
    for (const code of Object.keys(AGENT_ERRORS) as AgentErrorCode[]) {
      expect(agentError(code, { account: null, traceId: "t" }).body.next.action === "drop_credential").toBe(dropsCredential(code));
    }
  });

  it("keep the credential through timeouts and our own failures", () => {
    for (const code of ["internal_error", "upstream_error", "token_expired", "unauthorized", "rate_limited"] as const) {
      expect(dropsCredential(code)).toBe(false);
      expect(agentError(code, { account: null, traceId: "t" }).body.next.action).not.toBe("drop_credential");
    }
  });
});
