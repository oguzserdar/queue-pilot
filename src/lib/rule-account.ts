/**
 * @fileoverview Which playbook account a directly connected Mastodon or Bluesky account is. Rules limited to named
 * accounts hold Buffer channel ids, and a directly connected account has none of its own, so it is matched to the
 * Buffer channel with the same account id on that network (and, for Mastodon, the same server). An unsure match is never guessed: the reply path then
 * judges the rules of every Buffer account on that network it could be (see applicableRules in replies.ts).
 */
import { and, eq } from "drizzle-orm";
import * as z from "zod";
import { db } from "../db";
import { bufferSnapshot, socialAccount } from "../db/schema";
import type { RuleAccount } from "./replies";

type BufferChannel = { id: string; name: string; service: string; serviceId?: string | null; externalLink?: string | null };

// The snapshot's channels as matching reads them; a channel without an id or a network cannot match and is skipped.
const SnapshotChannels = z.object({ channels: z.array(z.unknown()) });
const ChannelShape = z.object({
  id: z.string(),
  name: z.string().catch(""),
  service: z.string(),
  serviceId: z.string().nullish().catch(undefined),
  externalLink: z.string().nullish().catch(undefined),
});

const origin = (u: string | null | undefined) => {
  try { return u ? new URL(u).origin.toLowerCase() : null; } catch { return null; }
};

/**
 * Matches a connected account against the person's Buffer channels on its network, by the network's own account id
 * (Buffer's serviceId, "the external ID of the channel on social network API", developers.buffer.com/reference). A
 * Mastodon id is unique only on its server, so the channel's link must be on the same server. A name never matches on
 * its own: two servers can both have an "ada".
 *
 * @param channels - The Buffer channels from the person's snapshot
 * @param account - The connected account: its network, its id on that network, and its server
 * @returns The one matching channel as `id`, and every channel on that network as `candidates`
 */
export function matchRuleAccount(channels: BufferChannel[], account: { network: string; accountId: string; server: string }): RuleAccount {
  const same = channels.filter((c) => c.service === account.network);
  const hits = same.filter((c) => c.serviceId === account.accountId && (account.network !== "mastodon" || origin(c.externalLink) === origin(account.server)));
  const candidates = same.map((c) => c.id);
  return hits.length === 1 ? { id: hits[0].id, candidates } : { candidates };
}

/**
 * The playbook account for one connected account, read from the database (no credentials are read).
 *
 * @returns Null when the account or the person's Buffer accounts are not known: every account-limited rule is then judged
 */
export async function ruleAccountFor(userId: string, network: string, accountId: string): Promise<RuleAccount | null> {
  const [acc] = await db().select({ network: socialAccount.network, accountId: socialAccount.accountId, server: socialAccount.server }).from(socialAccount).where(and(eq(socialAccount.id, accountId), eq(socialAccount.userId, userId))).limit(1);
  if (!acc) return null;
  const [snap] = await db().select({ data: bufferSnapshot.data }).from(bufferSnapshot).where(eq(bufferSnapshot.userId, userId)).limit(1);
  const read = SnapshotChannels.safeParse(snap?.data);
  // No snapshot at all: nothing says which Buffer accounts exist, so every account-limited rule is judged.
  if (!read.success) return null;
  const channels = read.data.channels.flatMap((c) => {
    const channel = ChannelShape.safeParse(c);
    return channel.success ? [channel.data] : [];
  });
  return matchRuleAccount(channels, { network, accountId: acc.accountId, server: acc.server });
}
