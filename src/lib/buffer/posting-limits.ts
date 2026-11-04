/**
 * @fileoverview Buffer's daily posting limits per channel (reference: dailyPostingLimits). One request covers the
 * channels of one organization at one intended time; X counts its busiest rolling 24 hours.
 */
import { bufferQuery } from "./client";

/** Buffer's daily posting-limit query, shared by saving drafts and the limits report. */
export const DAILY_LIMITS_QUERY = `query ($input: DailyPostingLimitsInput!) {
  dailyPostingLimits(input: $input) { channelId isAtLimit limit scheduled sent }
}`;

/** One channel's limit status: limit null means the network has none. */
export type LimitStatus = { channelId: string; isAtLimit: boolean; limit: number | null; scheduled: number; sent: number };

/**
 * Posting-limit status for these channels at one time, one request per organization.
 *
 * @param token - The person's Buffer access token
 * @param channels - Channels with the organization each belongs to
 * @param at - The intended posting time
 * @returns Each channel's status (channels Buffer did not answer for are left out) and the requests made
 */
export async function postingLimits(token: string, channels: { id: string; organizationId: string }[], at: Date, run: typeof bufferQuery = bufferQuery): Promise<{ limits: LimitStatus[]; requests: number }> {
  const byOrg = new Map<string, string[]>();
  for (const c of channels) byOrg.set(c.organizationId, [...(byOrg.get(c.organizationId) ?? []), c.id]);
  const answers = await Promise.all([...byOrg.values()].map((channelIds) => run<{ dailyPostingLimits: LimitStatus[] }>(token, DAILY_LIMITS_QUERY, { input: { channelIds, date: at.toISOString() } })));
  return { limits: answers.flatMap((a) => a.dailyPostingLimits), requests: answers.length };
}
