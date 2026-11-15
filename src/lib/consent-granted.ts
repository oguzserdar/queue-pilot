/**
 * @fileoverview Recognises a granted AI-app consent after Better Auth's /oauth2/consent ran, so Security activity can
 * record "Connected <app>". Only an Allow that Better Auth accepted counts; a Deny or a refused request does not.
 * The app is read from the signed oauth_query the consent screen sent; the caller still checks the stored approval.
 */
import { isAPIError } from "better-auth/api";
import * as z from "zod";

/** The parts of Better Auth's after-hook context this needs. */
export type ConsentHookContext = {
  path?: string;
  body?: unknown;
  context: { returned?: unknown; session?: { user?: { id?: string } } | null };
};

/**
 * Who granted which app, or null when this request was not an accepted consent.
 *
 * @param ctx - Better Auth's after-hook context
 * @returns The person and the app's client id
 */
// An Allow sends accept: true and the signed query as a string; anything else is not an accepted consent.
const AllowBody = z.object({ accept: z.literal(true), oauth_query: z.string() });

export function consentGranted(ctx: ConsentHookContext): { userId: string; clientId: string } | null {
  if (ctx.path !== "/oauth2/consent") return null;
  const parsed = AllowBody.safeParse(ctx.body);
  if (!parsed.success) return null;
  const body = parsed.data;
  if (ctx.context.returned === undefined || isAPIError(ctx.context.returned)) return null;
  const userId = ctx.context.session?.user?.id;
  const clientId = new URLSearchParams(body.oauth_query).get("client_id");
  return userId && clientId ? { userId, clientId } : null;
}
