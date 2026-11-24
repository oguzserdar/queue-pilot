/**
 * @fileoverview Who runs a deployment. Better Auth's admin plugin keeps a role on each user. A fresh deployment has no
 * admin: /admin then offers the signed-in person one button to become it, the way a first install sets up its owner.
 * Once an admin exists the button is gone; `pnpm admin:grant <email>` adds or repairs one from the server.
 */
import { eq, sql } from "drizzle-orm";
import * as z from "zod";
import { db } from "../db";
import { user } from "../db/auth-schema";

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
export const roleOf = (sessionUser: object): string | null | undefined => {
  const role = "role" in sessionUser ? sessionUser.role : undefined;
  return typeof role === "string" || role === null ? role : undefined;
};

// A raw query answers { rows } on node-postgres and PGLite; a driver that answers the rows themselves is read as is.
const WithRows = z.object({ rows: z.array(z.unknown()) });
const rowsOf = (res: unknown): unknown[] => {
  const withRows = WithRows.safeParse(res);
  return withRows.success ? withRows.data.rows : z.array(z.unknown()).catch([]).parse(res);
};
const FoundRow = z.object({ found: z.unknown().optional() });
// node-postgres counts changed rows in rowCount (null when it has none), PGLite in affectedRows.
const ChangedCount = z.object({ rowCount: z.number().nullish().catch(undefined), affectedRows: z.number().optional().catch(undefined) }).catch({});

/**
 * Whether this deployment already has an admin.
 *
 * @returns True once any user holds the admin role
 */
export async function hasAdmin(): Promise<boolean> {
  const res = await db().execute(sql`select exists (select 1 from "user" where ${ADMIN_ROLE}) as found`);
  const first = FoundRow.safeParse(rowsOf(res)[0]);
  return Boolean(first.success ? first.data.found : undefined);
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
    const r = ChangedCount.parse(res);
    return (r.rowCount ?? r.affectedRows ?? 0) > 0;
  });
}

/**
 * Whether this user is an admin right now, read from the database on every call, never from a session or a token.
 * A ban that has not ended takes the admin's power away too, as it does for the connector.
 *
 * @param userId - The user to check
 * @returns True when the user holds the admin role and is not banned
 */
export async function userIsAdmin(userId: string): Promise<boolean> {
  const [row] = await db().select({ role: user.role, banned: user.banned, banExpires: user.banExpires }).from(user).where(eq(user.id, userId));
  if (!row || !isAdminRole(row.role)) return false;
  const banEnds = row.banExpires === null ? null : new Date(row.banExpires);
  return row.banned !== true || (banEnds !== null && banEnds.getTime() < Date.now());
}
