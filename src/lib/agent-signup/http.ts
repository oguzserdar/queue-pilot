/**
 * The one door for every call a signed-up agent makes with its access token, and the reply helpers every agent route
 * uses, so no route can skip a check or answer in a different shape.
 *
 * authorizeAgent runs the same steps, in this order, on every call:
 *   1. a Bearer token is present                 → else unauthorized
 *   2. it verifies as an agent access token       → else unauthorized, token_expired, or internal_error (keep it)
 *   3. its registration row still exists          → else account_deleted (the cleanup job removed it)
 *   4. the registration was not revoked           → else agent_revoked
 *   5. lifecycle() says it is not deleted         → else account_deleted (enforced here even before the job runs)
 *   6. the agent is within its call limit         → else rate_limited
 *   7. for a write, the account is not frozen     → else account_frozen
 * Steps 3 to 5 read the row on every call, because a signature cannot know about a revoke or a deadline that came
 * after signing (sign-up contract §4).
 *
 * The access token is checked against the agent rules only (tokens.ts): its audience is this site's /v1/, never the
 * connector's /api/mcp, so it cannot be used there, and a person's connector token cannot be used here.
 *
 * agentRoute wraps every handler: a deployment that is not set up yet, or any thrown error, still answers with the
 * flat error shape and a trace id, never Next's error page. The agent keeps its credential on all of these.
 */
import { randomBytes } from "node:crypto";
import * as z from "zod";
import { agentError, lifecycle, type AccountBlock, type AgentErrorCode } from "./envelope";
import { limit, limitHeaders } from "../rate-limit";
import { accountFor, findRegistration, touchRegistration, type Registration } from "./registrations";
import { agentServer, type AgentServer } from "./server";
import { verifyAccessToken } from "./tokens";

export const traceId = () => `tr_${randomBytes(9).toString("base64url")}`;

const NO_STORE = { "Cache-Control": "no-store" };

/** A successful JSON reply. The body must already carry `account`. */
export function ok(body: Record<string, unknown>, status = 200, headers: Record<string, string> = {}): Response {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

/** An error reply in the contract's flat shape. */
export function fail(code: AgentErrorCode, opts: { account?: AccountBlock | null; retryAfter?: number; description?: string; headers?: Record<string, string> } = {}): Response {
  const e = agentError(code, { account: opts.account ?? null, traceId: traceId(), retryAfter: opts.retryAfter, description: opts.description });
  return Response.json(e.body, { status: e.status, headers: { ...e.headers, ...opts.headers } });
}

export type AgentCall = { server: AgentServer; registration: Registration; account: AccountBlock; now: Date };

/** The error each token refusal answers with: an expired token can be traded again; our own failure is not the agent's. */
const REFUSED_CODE = { expired: "token_expired", unavailable: "internal_error", invalid: "unauthorized" } as const;

/** Runs the door's steps for one call. On refusal, `res` is the reply to send as it is. */
export async function authorizeAgent(req: Request, server: AgentServer, opts: { write: boolean }): Promise<{ ok: true; call: AgentCall } | { ok: false; res: Response }> {
  const now = new Date();
  const header = req.headers.get("authorization") ?? "";
  const token = /^Bearer\s+(\S+)$/i.exec(header)?.[1];
  if (!token) return { ok: false, res: fail("unauthorized", { headers: { "WWW-Authenticate": 'Bearer realm="agent"' } }) };

  const v = await verifyAccessToken(server.signer, { baseURL: server.baseURL, token });
  if (!v.ok) {
    const code = REFUSED_CODE[v.reason];
    return { ok: false, res: fail(code, { headers: { "WWW-Authenticate": 'Bearer realm="agent", error="invalid_token"' } }) };
  }

  const registration = await findRegistration(v.registrationId);
  if (!registration) return { ok: false, res: fail("account_deleted") };
  const account = await accountFor(server, registration, now);
  if (registration.revokedAt) return { ok: false, res: fail("agent_revoked", { account }) };
  const life = lifecycle(registration.createdAt, registration.claimedAt, now);
  if (life.state === "deleted") return { ok: false, res: fail("account_deleted", { account }) };

  const l = await limit("agentCall", registration.id, now.getTime());
  if (!l.ok) return { ok: false, res: fail("rate_limited", { account, retryAfter: l.resetSeconds, headers: limitHeaders("agentCall", l) }) };

  if (opts.write && life.state === "frozen") return { ok: false, res: fail("account_frozen", { account }) };
  await touchRegistration(registration.id, now);
  return { ok: true, call: { server, registration, account, now } };
}

const TraceBody = z.object({ trace_id: z.string().optional().catch(undefined) }).catch({});

/** Wraps an agent route: a deployment that is not set up and any thrown error both answer in the flat shape. */
export function agentRoute(handler: (req: Request, server: AgentServer) => Promise<Response>): (req: Request) => Promise<Response> {
  return async (req) => {
    try {
      const server = await agentServer();
      if (!server) return fail("internal_error", { description: "This Queue Pilot server is not set up yet. Try again later." });
      return await handler(req, server);
    } catch (e) {
      const res = fail("internal_error");
      const body = TraceBody.parse(await res.clone().json());
      console.error(JSON.stringify({ event: "qp-agent-route-failed", trace_id: body.trace_id, path: new URL(req.url).pathname, message: e instanceof Error ? e.message : String(e) }));
      return res;
    }
  };
}

const isJsonObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Reads a JSON object body, or null when the body is not a JSON object. */
export async function jsonBody(req: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await req.json().catch(() => null);
  return isJsonObject(body) ? body : null;
}
