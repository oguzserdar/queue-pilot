/**
 * The link claim: a signed-in person opens the claim URL an agent showed them, sees what the agent saved, and takes
 * the account onto their own (sign-up contract §5, route "link").
 *
 * The link is a bearer link, as decided: whoever holds it and signs in can claim. The page shows the agent's label,
 * its saved work and, partly hidden, the address the agent named, with a warning when that is not the person's own,
 * so a link posted somewhere public is noticed before it is accepted.
 *
 * Accepting is one transaction, and every statement in it goes through that transaction:
 *   1. lock the registration row (SELECT ... FOR UPDATE), then the ticket;
 *   2. re-check everything under the lock: not claimed, not revoked, not deleted (lifecycle), ticket still live;
 *   3. set user_id and claimed_at, but only WHERE user_id IS NULL, so even without the lock a second writer
 *      could not overwrite the first;
 *   4. mark this ticket used and void every other live ticket of the registration;
 *   5. record that the person kept the agent's grants (the closed list in qp_agent_grant, never admin);
 *   6. copy the agent's material into the person's material (qp_material), which fits cleanly: it was checked by the
 *      same rules at save time and is keyed by the same content hash, so a copy never duplicates an item the person
 *      already has. Drafts have no matching private store (a person's drafts live in Buffer, and claiming must not
 *      write to Buffer), so they stay where they are, owned by the person through the registration, and the page
 *      lists them.
 * Two accepts at once: the second waits on the row lock, then finds user_id set and answers already_claimed. Every
 * outcome is a named state with a next step; nothing spins.
 *
 * What a claim never does: create a Better Auth user, session, OAuth client, connector approval (oauth_consent) or
 * admin grant (qp_app_admin_grant), write to Buffer, or publish anything. It only sets ownership columns.
 */
import { and, eq, isNull, ne } from "drizzle-orm";
import { db } from "../../db";
import { agentArtifact, agentGrant, agentRegistration, claimTicket, material } from "../../db/schema";
import { itemFor } from "../material-store";
import { countArtifacts, listArtifacts, type Artifact } from "./artifacts";
import { parseClaimToken, verifyClaimToken, type LinkRoute } from "./claim-link";
import { lifecycle } from "./envelope";
import { maskEmail, type Registration } from "./registrations";
import type { AgentServer } from "./server";

/** Why a claim page cannot offer Accept. Each has its own words on the page. */
export type ClaimRefusal = "ticket_unknown" | "ticket_used" | "already_claimed" | "account_deleted";

export type ClaimView =
  | { state: ClaimRefusal }
  /** Already claimed, by the person looking: the page shows what came with it. */
  | { state: "yours"; tool: string | null; label: string | null; material: Artifact[]; drafts: Artifact[]; materialCount: number; draftCount: number }
  | {
    state: "open";
    registrationId: string;
    tool: string | null;
    label: string | null;
    firstSeen: string;
    frozen: boolean;
    deleteAt: string;
    /** The address the agent named, partly hidden, and whether it differs from the viewer's. */
    namedAddress: string | null;
    addressDiffers: boolean;
    /** The newest items, up to the list limit; the counts are the totals that Accept takes over. */
    material: Artifact[];
    drafts: Artifact[];
    materialCount: number;
    draftCount: number;
  };

type Ticket = typeof claimTicket.$inferSelect;

const isLinkRoute = (route: string): route is LinkRoute => route === "link" || route === "email";

/** Finds the ticket a presented token names and checks its mac. Null for anything that is not a valid link of ours. */
async function ticketFor(server: AgentServer, token: string, now: Date): Promise<Ticket | null> {
  const parsed = parseClaimToken(token);
  if (!parsed) return null;
  const [ticket] = await db().select().from(claimTicket).where(eq(claimTicket.id, parsed.ticketId)).limit(1);
  if (!ticket || !isLinkRoute(ticket.route)) return null;
  const valid = verifyClaimToken(server.linkSecrets, token, { route: ticket.route, ticketId: ticket.id, registrationId: ticket.registrationId }, now);
  return valid ? ticket : null;
}

/** The refusal for this registration and ticket as of now, or null when Accept may be offered. */
function refusal(reg: Registration, ticket: Ticket, now: Date): ClaimRefusal | null {
  if (reg.userId) return "already_claimed";
  if (reg.revokedAt || lifecycle(reg.createdAt, reg.claimedAt, now).state === "deleted") return "account_deleted";
  if (ticket.state !== "live") return "ticket_used";
  return null;
}

/** What the claim page shows for this token and viewer. */
export async function claimView(server: AgentServer, token: string, viewer: { userId: string; email: string }, now = new Date()): Promise<ClaimView> {
  const ticket = await ticketFor(server, token, now);
  if (!ticket) return { state: "ticket_unknown" };
  const [reg] = await db().select().from(agentRegistration).where(eq(agentRegistration.id, ticket.registrationId)).limit(1);
  if (!reg) return { state: "account_deleted" };
  const refused = refusal(reg, ticket, now);
  const [mat, drafts, materialCount, draftCount] = await Promise.all([
    listArtifacts(reg.id, "material"), listArtifacts(reg.id, "draft"), countArtifacts(reg.id, "material"), countArtifacts(reg.id, "draft"),
  ]);
  if (refused === "already_claimed" && reg.userId === viewer.userId) return { state: "yours", tool: reg.tool, label: reg.label, material: mat, drafts, materialCount, draftCount };
  if (refused) return { state: refused };
  const life = lifecycle(reg.createdAt, reg.claimedAt, now);
  return {
    state: "open",
    registrationId: reg.id,
    tool: reg.tool,
    label: reg.label,
    firstSeen: reg.createdAt.toISOString(),
    frozen: life.state === "frozen",
    deleteAt: life.claimed ? "" : life.deleteAt.toISOString(),
    namedAddress: reg.ownerEmailHint ? maskEmail(reg.ownerEmailHint) : null,
    addressDiffers: Boolean(reg.ownerEmailHint && reg.ownerEmailHint !== viewer.email.trim().toLowerCase()),
    material: mat,
    drafts,
    materialCount,
    draftCount,
  };
}

export type ClaimResult = { ok: true; registrationId: string; copiedMaterial: number; drafts: number } | { ok: false; reason: ClaimRefusal };

/** Attaches the registration named by the token, and everything it saved, to this person. See the file header. */
export async function acceptClaim(server: AgentServer, token: string, userId: string, now = new Date()): Promise<ClaimResult> {
  const found = await ticketFor(server, token, now);
  if (!found) return { ok: false, reason: "ticket_unknown" };

  return db().transaction(async (tx) => {
    // 1. Locks, registration first: every accept for this account queues here.
    const [reg] = await tx.select().from(agentRegistration).where(eq(agentRegistration.id, found.registrationId)).for("update");
    if (!reg) return { ok: false, reason: "account_deleted" } as const;
    const [ticket] = await tx.select().from(claimTicket).where(eq(claimTicket.id, found.id)).for("update");
    // 2. Every check again, under the lock.
    const refused = refusal(reg, ticket, now);
    if (refused) return { ok: false, reason: refused } as const;

    // 3. Ownership, guarded so it can only ever be set once.
    const [won] = await tx.update(agentRegistration).set({ userId, claimedAt: now })
      .where(and(eq(agentRegistration.id, reg.id), isNull(agentRegistration.userId))).returning({ id: agentRegistration.id });
    if (!won) return { ok: false, reason: "already_claimed" } as const;

    // 4. This ticket is used; every other way to claim this account is void.
    await tx.update(claimTicket).set({ state: "used", usedAt: now, claimedBy: userId }).where(eq(claimTicket.id, ticket.id));
    await tx.update(claimTicket).set({ state: "void" })
      .where(and(eq(claimTicket.registrationId, reg.id), eq(claimTicket.state, "live"), ne(claimTicket.id, ticket.id)));

    // 5. The person kept the agent with the grants it already had. The table's closed list has no admin capability.
    await tx.update(agentGrant).set({ source: "claim", grantedBy: userId }).where(eq(agentGrant.registrationId, reg.id));

    // 6. Material into the person's material, keyed by content so nothing is duplicated.
    const artifacts = await tx.select().from(agentArtifact).where(eq(agentArtifact.registrationId, reg.id));
    let copiedMaterial = 0;
    for (const a of artifacts.filter((x) => x.kind === "material")) {
      // Checked by the same rules when it was saved; one that no longer passes stays an artifact rather than failing the claim.
      let item: ReturnType<typeof itemFor>;
      try {
        item = itemFor({ title: a.title, text: a.text, ...(a.link ? { link: a.link } : {}) });
      } catch {
        continue;
      }
      const inserted = await tx.insert(material).values({ userId, key: item.key, title: item.title, text: item.text, link: item.link ?? null }).onConflictDoNothing().returning({ key: material.key });
      if (inserted.length) copiedMaterial++;
      await tx.update(agentArtifact).set({ copiedTo: item.key }).where(eq(agentArtifact.id, a.id));
    }
    return { ok: true, registrationId: reg.id, copiedMaterial, drafts: artifacts.length - artifacts.filter((x) => x.kind === "material").length } as const;
  });
}
