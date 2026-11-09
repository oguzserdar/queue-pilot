import "server-only";
/**
 * The check every cron route runs first: the request must carry "Authorization: Bearer <CRON_SECRET>". Without a
 * secret configured, nothing is authorized.
 */
import { timingSafeEqual } from "node:crypto";

/**
 * True when the request carries the cron secret, compared in constant time.
 *
 * @param header - The request's Authorization header
 * @param secret - CRON_SECRET; unset or empty refuses everything
 */
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}
