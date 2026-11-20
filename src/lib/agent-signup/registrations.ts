/**
 * Registration rows: creating one for an agent that signs itself up, and reading one back into the account block every
 * reply carries (sign-up contract §4 and §5).
 *
 * Registering is one transaction with three inserts: the registration, its link ticket, and the starting grants. The
 * assertion is signed before the transaction, because signing may create the first signing key and that write belongs
 * to Better Auth, not to us. If the transaction then fails, the signed assertion names a registration that does not
 * exist, and the token endpoint refuses it.
 *
 * The claim link is rebuilt for each reply from the live link ticket (claim-link.ts), so the same URL comes back until
 * the account is claimed or deleted, and the database never holds a working link.
 */
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { user } from "../../db/auth-schema";
import { agentGrant, agentRegistration, claimTicket } from "../../db/schema";
import { claimUrl } from "./claim-link";
import { accountBlock, type AccountBlock } from "./envelope";
import type { AgentServer } from "./server";
import { issueIdentityAssertion } from "./tokens";

/** What every agent may do at once. Everything else waits for a claim (see CAPABILITIES_AFTER_CLAIM). */
export const STARTING_CAPABILITIES = ["save_material", "save_drafts"] as const;
export type AgentCapability = (typeof STARTING_CAPABILITIES)[number];

/**
 * Capabilities the registration reply lists as refused, so an agent knows up front what needs its person. They are
 * names in a reply, never rows: no code path grants them to an agent, and a claim is necessary for them, not enough.
 * Admin access is not on the list at all, because no agent gets it, claimed or not.
 */
export const CAPABILITIES_AFTER_CLAIM = ["read_buffer", "write_buffer", "approve_and_schedule", "send_posts_and_replies", "connect_accounts", "built_in_ai"] as const;

export type Registration = typeof agentRegistration.$inferSelect;

/** A random id with a readable prefix: 128 bits, base64url. */
export const newId = (prefix: string) => `${prefix}_${randomBytes(16).toString("base64url")}`;

export type RegisterInput = { tool: string | null; label: string | null; loginHint: string | null; source: string | null; ipHash: string | null };

/** Creates a registration with its link ticket and starting grants, and mints its identity assertion. */
export async function createRegistration(server: AgentServer, input: RegisterInput, now = new Date()) {
  const id = newId("reg");
  const assertion = await issueIdentityAssertion(server.signer, { baseURL: server.baseURL, registrationId: id, now });
  const ticketId = newId("tk");
  const registration = await db().transaction(async (tx) => {
    const [row] = await tx.insert(agentRegistration).values({
      id, tool: input.tool, label: input.label, source: input.source, ownerEmailHint: input.loginHint,
      assertionJti: assertion.jti, assertionExpiresAt: assertion.expiresAt, ipHash: input.ipHash, createdAt: now, lastSeenAt: now,
    }).returning();
    await tx.insert(claimTicket).values({ id: ticketId, registrationId: id, route: "link", createdAt: now });
    await tx.insert(agentGrant).values(STARTING_CAPABILITIES.map((capability) => ({ registrationId: id, capability, source: "register" as const, grantedAt: now })));
    return row;
  });
  return { registration, assertion };
}

export async function findRegistration(id: string): Promise<Registration | null> {
  const [row] = await db().select().from(agentRegistration).where(eq(agentRegistration.id, id)).limit(1);
  return row ?? null;
}

/** Notes that the agent was seen; a failed write never fails the call. */
export async function touchRegistration(id: string, now = new Date()): Promise<void> {
  await db().update(agentRegistration).set({ lastSeenAt: now }).where(eq(agentRegistration.id, id))
    .catch((e) => console.error(JSON.stringify({ event: "qp-agent-touch-failed", message: e instanceof Error ? e.message : String(e) })));
}

/** j***@e*****.com: enough for the agent's person to recognise their own address, not enough to read someone else's. */
export function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  const dot = domain.lastIndexOf(".");
  const name = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local.slice(0, 1)}***@${name.slice(0, 1)}${"*".repeat(Math.max(1, name.length - 1))}${tld}`;
}

/** The registration's live link ticket id, or null once it was used or voided. */
async function liveLinkTicket(registrationId: string): Promise<string | null> {
  const [t] = await db().select({ id: claimTicket.id }).from(claimTicket)
    .where(and(eq(claimTicket.registrationId, registrationId), eq(claimTicket.route, "link"), eq(claimTicket.state, "live"))).limit(1);
  return t?.id ?? null;
}

/** The account block for this registration as of `now`: deadlines, the claim link, and who claimed it. */
export async function accountFor(server: AgentServer, reg: Registration, now = new Date()): Promise<AccountBlock> {
  let link: string | null = null;
  let claimedBy: string | null = null;
  if (reg.userId) {
    const [u] = await db().select({ email: user.email }).from(user).where(eq(user.id, reg.userId)).limit(1);
    claimedBy = u ? maskEmail(u.email) : null;
  } else {
    const ticketId = await liveLinkTicket(reg.id);
    link = ticketId ? claimUrl(server.baseURL, server.linkSecrets, { route: "link", ticketId, registrationId: reg.id }) : null;
  }
  return accountBlock({ id: reg.id, createdAt: reg.createdAt, claimedAt: reg.claimedAt, claimUrl: link, claimedBy, now });
}

/** The capability list for a reply: what this agent holds now, and what waits for its person. */
export async function capabilityList(registrationId: string) {
  const rows = await db().select({ capability: agentGrant.capability }).from(agentGrant).where(eq(agentGrant.registrationId, registrationId));
  const held = new Set(rows.map((r) => r.capability));
  return [
    ...STARTING_CAPABILITIES.map((capability) => (held.has(capability) ? { capability, granted: true } : { capability, granted: false, reason: "not_granted" })),
    ...CAPABILITIES_AFTER_CLAIM.map((capability) => ({ capability, granted: false, reason: "requires_claim" })),
  ];
}

/** True when this registration holds the capability. */
export async function holds(registrationId: string, capability: AgentCapability): Promise<boolean> {
  const [row] = await db().select({ c: agentGrant.capability }).from(agentGrant)
    .where(and(eq(agentGrant.registrationId, registrationId), eq(agentGrant.capability, capability))).limit(1);
  return Boolean(row);
}
