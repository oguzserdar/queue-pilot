/**
 * @fileoverview One inbox, one account. `ada+qp@x.com` and `ada@x.com` reach the same inbox, and so do the dot variants
 * of a Gmail address, so a second account for the same inbox would let one person collect a second free AI allowance.
 * The rule: drop a `+tag` when that leaves a non-empty name, and for Gmail also drop dots and treat googlemail.com as
 * gmail.com. Only a VERIFIED account
 * blocks another: counting unverified ones would let a stranger block someone by signing up as their +alias first.
 */
import "server-only";
import { and, eq, ilike, ne, or } from "drizzle-orm";
import { db } from "../db";
import { user } from "../db/auth-schema";

const GMAIL = new Set(["gmail.com", "googlemail.com"]);

/** The inbox an address reaches, for comparing accounts. Never shown, never stored. */
export function canonicalEmail(raw: string): string {
  const email = raw.replace(/[​-‍﻿]/g, "").trim().toLowerCase().replace(/\.$/, "");
  const at = email.lastIndexOf("@");
  if (at <= 0 || at === email.length - 1) return email;
  const original = email.slice(0, at);
  let local = original;
  let domain = email.slice(at + 1);
  const plus = local.indexOf("+");
  if (plus > 0) local = local.slice(0, plus);
  if (GMAIL.has(domain)) {
    const noDots = local.replace(/\./g, "");
    if (noDots) local = noDots;
    domain = "gmail.com";
  }
  return `${local || original}@${domain}`;
}

/**
 * True when another verified account already uses the same inbox as `email`.
 *
 * @param exceptUserId - The account being verified, which never blocks itself
 */
export async function inboxTaken(email: string, exceptUserId: string): Promise<boolean> {
  const canon = canonicalEmail(email);
  const domain = canon.slice(canon.lastIndexOf("@") + 1);
  const domains = domain === "gmail.com" ? ["gmail.com", "googlemail.com"] : [domain];
  // The database only narrows to the same domain; the exact match is the one function above.
  const rows = await db().select({ id: user.id, email: user.email }).from(user)
    .where(and(eq(user.emailVerified, true), ne(user.id, exceptUserId), or(...domains.map((d) => ilike(user.email, `%@${d}`)))));
  return rows.some((r) => canonicalEmail(r.email) === canon);
}
