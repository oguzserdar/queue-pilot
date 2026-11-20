/**
 * POST /v1/agent/identity: an AI agent signs itself up, with no person present (sign-up contract §2 Step 2).
 *
 * One call returns everything the agent needs to start: its registration id, its lasting identity assertion (shown
 * once, never again), the account block with the claim link and both deadlines, and the list of what it may do now.
 *
 * Checks, in order:
 *   1. the operator's switch (agent_signup in /admin, or AGENT_SIGNUP) is on   → else registration_disabled
 *   2. the body is a JSON object with type "anonymous" and valid optional fields → else invalid_request,
 *      identity_type_not_enabled or invalid_login_hint
 *   3. this address has registered fewer than 3 times today and tried fewer than 10 times this minute
 *                                                                                → else registration_limited
 * Validation comes before counting, so a malformed request never uses up an address's day.
 *
 * The address is the one src/lib/client-ip.ts trusts (TRUSTED_PROXY_HOP_COUNT, TRUSTED_PROXIES). On a deployment
 * that has not set those, every caller shares one bucket, so the limit is 3 sign-ups a day for the whole server:
 * safe, and a reason to set them. The address is stored only as an HMAC (server.ts).
 *
 * login_hint is stored lower-cased as a hint. It proves nothing and grants nothing; it only lets the person claim by
 * email or by signing in, in a later part. It is never copied into the person's account.
 */
import { clientIp } from "@/lib/client-ip";
import { operatorSetting } from "@/lib/env";
import { limit, limitHeaders } from "@/lib/rate-limit";
import { agentReply } from "@/lib/agent-signup/envelope";
import { agentRoute, fail, jsonBody, ok } from "@/lib/agent-signup/http";
import { accountFor, capabilityList, createRegistration, type RegisterInput } from "@/lib/agent-signup/registrations";

const TOOL = /^[a-z0-9._-]{1,36}$/;
const SOURCE = /^[A-Za-z0-9._:/@+-]{1,100}$/;
// A practical address check: one @, no spaces, a dot in the domain. Proof of ownership comes later, from sign-in.
const EMAIL = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const MAX_LABEL = 40;

/** A character kept in a label: not a control character (U+0000 to U+001F, U+007F) and not an angle bracket. */
function labelCharacter(ch: string): boolean {
  const code = ch.charCodeAt(0);
  return code > 0x1f && code !== 0x7f && ch !== "<" && ch !== ">";
}

/** The label as plain text: control characters and angle brackets removed, spaces collapsed, cut to 40 characters. */
function plainLabel(s: string): string {
  return s.split("").filter(labelCharacter).join("").replace(/\s+/g, " ").trim().slice(0, MAX_LABEL);
}

/** An optional string field: absent or null is null, a string is itself, anything else is undefined (invalid). */
function optionalString(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return null;
  return typeof value === "string" ? value : undefined;
}

type Parsed = { ok: true; input: Omit<RegisterInput, "ipHash"> } | { ok: false; code: "invalid_request" | "identity_type_not_enabled" | "invalid_login_hint"; description?: string };

function parse(body: Record<string, unknown> | null): Parsed {
  if (!body) return { ok: false, code: "invalid_request", description: "Send a JSON object: {\"type\": \"anonymous\"}." };
  if (body.type !== "anonymous") return typeof body.type === "string" ? { ok: false, code: "identity_type_not_enabled" } : { ok: false, code: "invalid_request", description: "type is required: \"anonymous\"." };
  const str = (k: string) => optionalString(body[k]);
  const tool = str("tool"), label = str("label"), hint = str("login_hint"), source = str("source");
  if (tool === undefined || label === undefined || hint === undefined || source === undefined) return { ok: false, code: "invalid_request", description: "tool, label, login_hint and source are strings when present." };
  if (tool !== null && !TOOL.test(tool)) return { ok: false, code: "invalid_request", description: "tool is 1 to 36 characters of a-z 0-9 . _ -" };
  if (source !== null && !SOURCE.test(source)) return { ok: false, code: "invalid_request", description: "source is up to 100 characters of letters, digits and . _ : / @ + -" };
  const email = hint?.trim().toLowerCase() ?? null;
  if (email !== null && (email.length > 254 || !EMAIL.test(email))) return { ok: false, code: "invalid_login_hint" };
  return { ok: true, input: { tool, label: label === null ? null : plainLabel(label) || null, loginHint: email, source } };
}

export const POST = agentRoute(async (req, server) => {
  if ((await operatorSetting("agent_signup")) === "off") return fail("registration_disabled");

  const parsed = parse(await jsonBody(req));
  if (!parsed.ok) return fail(parsed.code, { description: parsed.description });

  const ipHash = server.ipHash(clientIp(req.headers));
  for (const rule of ["agentRegisterBurst", "agentRegister"] as const) {
    const l = await limit(rule, ipHash);
    if (!l.ok) return fail("registration_limited", { retryAfter: l.resetSeconds, headers: limitHeaders(rule, l) });
  }

  const now = new Date();
  const { registration, assertion } = await createRegistration(server, { ...parsed.input, ipHash }, now);
  const account = await accountFor(server, registration, now);
  return ok(agentReply({
    registration_id: registration.id,
    identity_assertion: assertion.token,
    assertion_expires: assertion.expiresAt.toISOString(),
    capabilities: await capabilityList(registration.id),
  }, account), 201);
});
