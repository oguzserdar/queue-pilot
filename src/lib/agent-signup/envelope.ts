/**
 * What every reply to a signed-up agent looks like (sign-up contract §4, §5 and §6).
 *
 * The rule: every reply, success or error, carries `account`. An agent never has to ask whether it has been
 * claimed or how long it has left; it reads the block it just received. `account` is null only when the caller is
 * unknown (no token, or one we could not read), and the key is still present, so agents can rely on the shape.
 *
 * The account's clock (decided for the sign-up contract, §5):
 *   sign-up ──72 h──▶ freeze_at ──30 days──▶ delete_at
 *   active            frozen: hidden, reads     deleted: rows removed, the link stops working
 *                     work, writes refused,
 *                     still claimable
 * The delete clock starts at the freeze, not at sign-up. A claim at any moment before delete_at ends the clock:
 * a frozen account that is claimed is simply active again, with nothing lost. `lifecycle` is a pure function of
 * three timestamps so the request path, the daily cleanup job and the tests all compute the same answer.
 *
 * Errors use one flat shape everywhere. `error` and `error_description` are the OAuth fields (RFC 6749 §5.2), so the
 * token endpoint stays a valid OAuth error response. The rest tell an agent what to do without reading prose:
 * - `origin`: request (fix what you sent), server (our fault) or upstream (a provider we use failed);
 * - `retryable`, with `retry_after` in seconds when we know it;
 * - `next.action`: one of nine verbs, plus a line it can show its person.
 *
 * Only three errors mean the credential is dead: invalid_grant, account_deleted and agent_revoked. Everything else,
 * including our own failures and errors the agent does not recognise, means keep it. An agent that deletes its
 * credential on a passing failure loses the only key to an account its person may still want; that is the failure
 * this rule exists to prevent.
 */

export const FREEZE_AFTER_MS = 72 * 60 * 60 * 1000;
export const DELETE_AFTER_FREEZE_MS = 30 * 24 * 60 * 60 * 1000;

export type Lifecycle =
  | { state: "active" | "frozen" | "deleted"; claimed: false; freezeAt: Date; deleteAt: Date }
  | { state: "active"; claimed: true; freezeAt: null; deleteAt: null };

/** An unclaimed account's state at time t: deleted from delete_at, frozen from freeze_at, else active. */
function unclaimedState(t: number, freezeAt: Date, deleteAt: Date): Lifecycle["state"] {
  if (t >= deleteAt.getTime()) return "deleted";
  if (t >= freezeAt.getTime()) return "frozen";
  return "active";
}

/** Where an account stands at `now`. Frozen from exactly freeze_at, deleted from exactly delete_at. */
export function lifecycle(createdAt: Date, claimedAt: Date | null, now: Date): Lifecycle {
  const freezeAt = new Date(createdAt.getTime() + FREEZE_AFTER_MS);
  const deleteAt = new Date(freezeAt.getTime() + DELETE_AFTER_FREEZE_MS);
  // A claim stamped at or after delete_at came too late: the account was already gone.
  if (claimedAt && claimedAt.getTime() < deleteAt.getTime()) return { state: "active", claimed: true, freezeAt: null, deleteAt: null };
  const t = now.getTime();
  return { state: unclaimedState(t, freezeAt, deleteAt), claimed: false, freezeAt, deleteAt };
}

/** The block in every reply. Field names are the contract's; `id` is the registration id. */
export type AccountBlock = {
  id: string;
  state: "unclaimed" | "frozen" | "deleted" | "claimed";
  claimed: boolean;
  /** Null once claimed or deleted. */
  claim_url: string | null;
  freeze_at: string | null;
  delete_at: string | null;
  /** Partly hidden address of the person who claimed it, for example j***@e*****.com. */
  claimed_by: string | null;
};

export function accountBlock(input: {
  id: string;
  createdAt: Date;
  claimedAt: Date | null;
  claimUrl: string | null;
  claimedBy: string | null;
  now: Date;
}): AccountBlock {
  const l = lifecycle(input.createdAt, input.claimedAt, input.now);
  if (l.claimed) return { id: input.id, state: "claimed", claimed: true, claim_url: null, freeze_at: null, delete_at: null, claimed_by: input.claimedBy };
  return {
    id: input.id,
    state: l.state === "active" ? "unclaimed" : l.state,
    claimed: false,
    claim_url: l.state === "deleted" ? null : input.claimUrl,
    freeze_at: l.freezeAt.toISOString(),
    delete_at: l.deleteAt.toISOString(),
    claimed_by: null,
  };
}

/** A successful reply: the body, with `account` always last and always present. */
export function agentReply<T extends Record<string, unknown>>(body: T, account: AccountBlock | null): Omit<T, "account"> & { account: AccountBlock | null } {
  return { ...body, account };
}

export type NextAction =
  | "fix_request"
  | "retry_later"
  | "re_exchange"
  | "register"
  | "show_claim_url"
  | "ask_person"
  | "use_other_route"
  | "drop_credential"
  | "stop";

type ErrorSpec = { status: number; origin: "request" | "server" | "upstream"; retryable: boolean; action: NextAction; description: string; say: string };

/** Every error an agent call can return. The HTTP status, retry and next step for each are fixed here, in one place. */
export const AGENT_ERRORS = {
  invalid_request: { status: 400, origin: "request", retryable: false, action: "fix_request", description: "The request is not valid.", say: "" },
  invalid_login_hint: { status: 400, origin: "request", retryable: false, action: "fix_request", description: "login_hint is not an email address. Fix it or leave it out.", say: "" },
  identity_type_not_enabled: { status: 400, origin: "request", retryable: false, action: "register", description: "Only type \"anonymous\" is accepted. Register with it.", say: "" },
  registration_disabled: {
    status: 403, origin: "request", retryable: false, action: "ask_person",
    description: "This Queue Pilot server does not accept agent sign-ups.",
    say: "This Queue Pilot server doesn't let agents sign up on their own. Sign in there and connect me from your account.",
  },
  registration_limited: {
    status: 429, origin: "request", retryable: true, action: "retry_later",
    description: "Too many sign-ups from this network today.",
    say: "Queue Pilot has had too many sign-ups from this network today. You can sign in and connect me instead.",
  },
  unsupported_grant_type: { status: 400, origin: "request", retryable: false, action: "fix_request", description: "Use grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer.", say: "" },
  invalid_target: { status: 400, origin: "request", retryable: false, action: "fix_request", description: "resource names something this server does not serve.", say: "" },
  invalid_grant: { status: 400, origin: "request", retryable: false, action: "drop_credential", description: "This identity assertion is not valid. Delete it and register again.", say: "" },
  unauthorized: { status: 401, origin: "request", retryable: false, action: "re_exchange", description: "Send Authorization: Bearer {access_token}, traded for your identity assertion.", say: "" },
  token_expired: { status: 401, origin: "request", retryable: true, action: "re_exchange", description: "The access token expired. Trade your identity assertion again and repeat the call.", say: "" },
  agent_revoked: {
    status: 401, origin: "request", retryable: false, action: "drop_credential",
    description: "Your person removed this agent from their account.",
    say: "You removed me from your Queue Pilot account, so I can't use it any more.",
  },
  account_frozen: {
    status: 403, origin: "request", retryable: false, action: "show_claim_url",
    description: "This account is frozen until it is claimed. Reads still work.",
    say: "Your Queue Pilot account is frozen until you claim it.",
  },
  capability_requires_claim: {
    status: 403, origin: "request", retryable: false, action: "show_claim_url",
    description: "This needs a claimed account.",
    say: "I need you to claim your Queue Pilot account before I can do that.",
  },
  account_deleted: {
    status: 410, origin: "request", retryable: false, action: "drop_credential",
    description: "This account was never claimed and has been deleted.",
    say: "That Queue Pilot account was never claimed, so it has been deleted.",
  },
  already_claimed: { status: 409, origin: "request", retryable: false, action: "stop", description: "This account is already claimed. Keep working.", say: "" },
  no_login_hint: {
    status: 400, origin: "request", retryable: false, action: "ask_person",
    description: "No address to send to. Ask your person for one, or show the claim link.",
    say: "Which email address should I send the claim link to?",
  },
  claim_email_refused: {
    status: 403, origin: "request", retryable: false, action: "use_other_route",
    description: "That address asked not to get claim emails. Offer the link instead.",
    say: "That address has turned off claim emails.",
  },
  claim_email_limit: { status: 429, origin: "request", retryable: false, action: "use_other_route", description: "No more claim emails for this account or address. Offer the link instead.", say: "" },
  slow_down: { status: 429, origin: "request", retryable: true, action: "retry_later", description: "Poll 5 seconds more slowly.", say: "" },
  rate_limited: { status: 429, origin: "request", retryable: true, action: "retry_later", description: "Too many requests. Wait retry_after seconds.", say: "" },
  not_found: { status: 404, origin: "request", retryable: false, action: "fix_request", description: "Nothing here by that name.", say: "" },
  upstream_error: { status: 502, origin: "upstream", retryable: true, action: "retry_later", description: "A provider Queue Pilot uses failed. Try again later.", say: "" },
  internal_error: { status: 500, origin: "server", retryable: true, action: "retry_later", description: "Queue Pilot failed. Try again later; quote trace_id if it repeats.", say: "" },
} as const satisfies Record<string, ErrorSpec>;

export type AgentErrorCode = keyof typeof AGENT_ERRORS;

/** The three errors after which an agent deletes its saved credential. Nothing else qualifies. */
const DEAD_CREDENTIAL: ReadonlySet<AgentErrorCode> = new Set(["invalid_grant", "account_deleted", "agent_revoked"]);

export function dropsCredential(code: AgentErrorCode): boolean {
  return DEAD_CREDENTIAL.has(code);
}

export type AgentErrorBody = {
  error: AgentErrorCode;
  error_description: string;
  origin: ErrorSpec["origin"];
  retryable: boolean;
  retry_after?: number;
  next: { action: NextAction; say: string; url?: string };
  trace_id: string;
  account: AccountBlock | null;
};

/**
 * An error reply: status, headers and body for the route to send. `say` is a line the agent can show its person;
 * when the next step is the claim link, it includes the link from the account block.
 */
export function agentError(
  code: AgentErrorCode,
  opts: { account: AccountBlock | null; traceId: string; retryAfter?: number; description?: string },
): { status: number; headers: Record<string, string>; body: AgentErrorBody } {
  const spec: ErrorSpec = AGENT_ERRORS[code];
  const claimUrl = spec.action === "show_claim_url" ? opts.account?.claim_url ?? undefined : undefined;
  const say = claimUrl ? `${spec.say} Claim it here: ${claimUrl}` : spec.say;
  const headers: Record<string, string> = { "Content-Type": "application/json", "Cache-Control": "no-store" };
  if (opts.retryAfter !== undefined) headers["Retry-After"] = String(opts.retryAfter);
  return {
    status: spec.status,
    headers,
    body: {
      error: code,
      error_description: opts.description ?? spec.description,
      origin: spec.origin,
      retryable: spec.retryable,
      ...(opts.retryAfter !== undefined ? { retry_after: opts.retryAfter } : {}),
      next: { action: spec.action, say, ...(claimUrl ? { url: claimUrl } : {}) },
      trace_id: opts.traceId,
      account: opts.account,
    },
  };
}
