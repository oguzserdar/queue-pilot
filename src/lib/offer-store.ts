/**
 * @fileoverview Home's offers a person set aside, so a hidden offer stays hidden on every device.
 *
 * | Offer | Shown | Set aside by |
 * |---|---|---|
 * | `welcome` | first visit: own AI or Queue Pilot's AI | "Not now" |
 * | `connect-ai` | no AI has called yet | × on the card |
 * | `add-ai` | one AI connected, another would add more | × on the card |
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { offerDismissed } from "../db/schema";

const OFFERS = ["welcome", "connect-ai", "add-ai"] as const;
/** One of Home's offers that a person can set aside. */
export type OfferKey = (typeof OFFERS)[number];

/** Whether a value names one of Home's offers; anything else is never stored. */
export const isOfferKey = (v: unknown): v is OfferKey => typeof v === "string" && (OFFERS as readonly string[]).includes(v);

/**
 * The offers this person set aside.
 *
 * @param userId - The signed-in person
 * @returns Their set-aside offer keys
 */
export async function dismissedOffers(userId: string): Promise<Set<OfferKey>> {
  const rows = await db().select({ key: offerDismissed.key }).from(offerDismissed).where(eq(offerDismissed.userId, userId));
  return new Set(rows.map((r) => r.key).filter(isOfferKey));
}

/**
 * Sets one offer aside for this person; doing it again changes nothing.
 *
 * @param userId - The signed-in person
 * @param key - The offer to hide
 */
export async function dismissOffer(userId: string, key: OfferKey): Promise<void> {
  await db().insert(offerDismissed).values({ userId, key }).onConflictDoNothing();
}

