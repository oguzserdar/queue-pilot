import { oauthProviderOpenIdConfigMetadata } from "@better-auth/oauth-provider";
import { getAuth } from "@/lib/auth";

type DiscoveryAuth = { handler: (req: Request) => Promise<Response>; api: { getOpenIdConfig: (...args: never[]) => unknown } };

/**
 * OAuth discovery lives at the site root (/.well-known/...), but Better Auth is mounted under /api/auth, so Next never
 * routes those paths to it. Better Auth's plugins match discovery requests by their full path, so passing the request
 * through unchanged is enough: mcp() answers /.well-known/oauth-protected-resource[/api/mcp] and the provider answers
 * /.well-known/oauth-authorization-server/api/auth. An unknown path falls through to Better Auth's own 404.
 */
export function forwardDiscovery(auth: DiscoveryAuth | null, req: Request): Promise<Response> | Response {
  if (!auth) return Response.json({ error: "Sign in with Buffer is not open yet" }, { status: 503 });
  return auth.handler(req);
}

/** The provider serves openid-configuration only under the issuer path; this serves the root form clients also try. */
export function openIdConfiguration(auth: DiscoveryAuth | null, req: Request): Promise<Response> | Response {
  if (!auth) return Response.json({ error: "Sign in with Buffer is not open yet" }, { status: 503 });
  return oauthProviderOpenIdConfigMetadata(auth as never)(req);
}

/** Route handler for /.well-known/oauth-protected-resource/* and /.well-known/oauth-authorization-server/*. */
export async function discoveryRoute(req: Request): Promise<Response> {
  return forwardDiscovery((await getAuth()) as DiscoveryAuth | null, req);
}

/** Route handler for /.well-known/openid-configuration/*. */
export async function openIdRoute(req: Request): Promise<Response> {
  return openIdConfiguration((await getAuth()) as DiscoveryAuth | null, req);
}
