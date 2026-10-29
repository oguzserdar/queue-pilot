/**
 * @fileoverview Who runs a deployment. Better Auth's admin plugin keeps a role on each user. A fresh deployment has no
 * admin: /admin then offers the signed-in person one button to become it, the way a first install sets up its owner.
 * Once an admin exists the button is gone; `pnpm admin:grant <email>` adds or repairs one from the server.
 */
import { sql } from "drizzle-orm";
import { db } from "../db";

const ADMIN_ROLE = sql`(role = 'admin' or role like 'admin,%' or role like '%,admin' or role like '%,admin,%')`;

/**
 * Whether a Better Auth role string grants admin. The admin plugin stores several roles comma-separated.
 *
 * @param role - The user's role column, e.g. "admin" or "user,admin"
 * @returns True when one of the roles is exactly "admin"
 */
export function isAdminRole(role: string | null | undefined): boolean {
  return (role ?? "").split(",").some((r) => r.trim() === "admin");
}

/** The admin plugin's role on a session user, which the session type does not declare. */
export const roleOf = (user: object): string | null | undefined => (user as { role?: string | null }).role;

/**
 * Whether this deployment already has an admin.
 *
 * @returns True once any user holds the admin role
 */
export async function hasAdmin(): Promise<boolean> {
  const res = await db().execute(sql`select exists (select 1 from "user" where ${ADMIN_ROLE}) as found`);
  const rows = (res as unknown as { rows?: { found: boolean }[] }).rows ?? (res as unknown as { found: boolean }[]);
  return Boolean(rows[0]?.found);
}

/**
 * Makes this user the admin when the deployment has none yet. The check and the update are one statement under a
 * transaction-scoped lock, so two people pressing the button at the same moment cannot both become admin.
 *
 * @param userId - The signed-in user claiming the deployment
 * @returns True when this call made them the admin
 */
export async function claimAdminIfNone(userId: string): Promise<boolean> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('qp-first-admin'))`);
    const res = await tx.execute(sql`update "user" set role = 'admin' where id = ${userId} and not exists (select 1 from "user" where ${ADMIN_ROLE})`);
    const r = res as unknown as { rowCount?: number; affectedRows?: number };
    return (r.rowCount ?? r.affectedRows ?? 0) > 0;
  });
}
