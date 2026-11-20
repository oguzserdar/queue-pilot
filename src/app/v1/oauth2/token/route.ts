/**
 * POST /v1/oauth2/token: an agent trades its identity assertion for a one-hour access token (RFC 7523 JWT bearer
 * grant; sign-up contract §2 Step 3). There is no refresh token: when the access token expires, the agent trades the
 * same assertion again.
 *
 * This is not Better Auth's /api/auth/oauth2/token, which serves the people's connector (authorization code with
 * PKCE, for people's AI apps) and needs a person. The two endpoints share the signing keys and nothing else.
 *
 * The registration row is checked on every trade, because the assertion lives a year and a signature cannot know
 * what happened since:
 *   - the row is gone, or lifecycle() says deleted   → account_deleted (drop the credential)
 *   - the row was revoked                           → agent_revoked (drop the credential)
 *   - the assertion's jti is not the row's current one → invalid_grant (it was replaced; drop it)
 *   - the account is frozen                          → a token is still issued: reads and claiming still work, and
 *                                                      writes are refused call by call (http.ts)
 * Only these three errors tell the agent to drop its credential. A failure on our side answers internal_error, and
 * the agent keeps it.
 *
 * Request: application/x-www-form-urlencoded, as OAuth token endpoints are (RFC 6749 §4.1.3). `resource` is optional;
 * when sent, it must name this site or its /v1/ API (RFC 8707), else invalid_target.
 */
import { clientIp } from "@/lib/client-ip";
import { limit, limitHeaders } from "@/lib/rate-limit";
import { agentReply, lifecycle } from "@/lib/agent-signup/envelope";
import { agentRoute, fail, ok } from "@/lib/agent-signup/http";
import { accountFor, findRegistration, touchRegistration } from "@/lib/agent-signup/registrations";
import { issueAccessToken, verifyIdentityAssertion } from "@/lib/agent-signup/tokens";

const JWT_BEARER = "urn:ietf:params:oauth:grant-type:jwt-bearer";

export const POST = agentRoute(async (req, server) => {
  const l = await limit("agentToken", server.ipHash(clientIp(req.headers)));
  if (!l.ok) return fail("rate_limited", { retryAfter: l.resetSeconds, headers: limitHeaders("agentToken", l) });

  const form = await req.formData().catch(() => null);
  if (!form) return fail("invalid_request", { description: "Send the form as application/x-www-form-urlencoded." });
  const grantType = form.get("grant_type");
  if (grantType !== JWT_BEARER) return fail(grantType ? "unsupported_grant_type" : "invalid_request", { description: grantType ? undefined : `grant_type is required: ${JWT_BEARER}.` });
  const assertion = form.get("assertion");
  if (typeof assertion !== "string" || !assertion) return fail("invalid_request", { description: "assertion is required: your identity_assertion." });
  const resource = form.get("resource");
  if (resource !== null && resource !== `${server.baseURL}/` && resource !== `${server.baseURL}/v1/` && resource !== server.baseURL) return fail("invalid_target");

  const v = await verifyIdentityAssertion(server.signer, { baseURL: server.baseURL, token: assertion });
  if (!v.ok) return fail(v.reason === "unavailable" ? "internal_error" : "invalid_grant");

  const now = new Date();
  const registration = await findRegistration(v.registrationId);
  if (!registration) return fail("account_deleted");
  const account = await accountFor(server, registration, now);
  if (registration.revokedAt) return fail("agent_revoked", { account });
  if (lifecycle(registration.createdAt, registration.claimedAt, now).state === "deleted") return fail("account_deleted", { account });
  if (registration.assertionJti !== v.jti) return fail("invalid_grant", { account });

  const issued = await issueAccessToken(server.signer, { baseURL: server.baseURL, registrationId: registration.id, now });
  await touchRegistration(registration.id, now);
  return ok(agentReply({ access_token: issued.token, token_type: "Bearer", expires_in: issued.expiresIn }, account), 200, { Pragma: "no-cache" });
});
