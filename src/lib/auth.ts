/**
 * Accounts and sessions (Better Auth 1.7.14). People sign in with Buffer through the generic OAuth plugin
 * (authorization code + PKCE at auth.buffer.com, offline_access for a refresh token). Better Auth stores the
 * Buffer tokens in its account table, encrypted (encryptOAuthTokens). The Buffer client id and secret can be
 * changed in /admin at runtime, so the auth instance is built lazily and rebuilt when those keys change.
 */
import { betterAuth } from "better-auth";
import { admin, genericOAuth, jwt } from "better-auth/plugins";
import { mcp } from "@better-auth/mcp";
import { cimd } from "@better-auth/cimd";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";
import { AUTHORIZE_URL, SCOPES, TOKEN_URL } from "./buffer/oauth";
import { bufferQuery } from "./buffer/client";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db, schema } from "../db";
import { hasDatabase } from "./db";
import { readConfig } from "./env";
import { portraitUrl, shownPortrait } from "./profile-display";

export const BUFFER_PROVIDER_ID = "buffer";

/** The connector endpoint that ChatGPT, Claude and Grok call; access tokens are bound to it as their audience. */
export const mcpResource = (baseURL: string) => `${baseURL}/api/mcp`;

/**
 * Buffer is the only way in, so the Buffer account id is the identity. Linking a new Buffer login to an existing user
 * because the email matches would let a second Buffer account with the same address take over the first user.
 */
export const ACCOUNT_OPTIONS = { encryptOAuthTokens: true, accountLinking: { disableImplicitLinking: true } } as const;

export function buildAuth(opts: { clientId: string; clientSecret?: string; secret: string; baseURL: string }) {
  return betterAuth({
    secret: opts.secret,
    baseURL: opts.baseURL,
    database: drizzleAdapter(db(), { provider: "pg", schema }),
    advanced: {
      database: { joins: true },
      // Behind a proxy that appends to x-forwarded-for (a reverse proxy in front of Docker), list its addresses so
      // each person gets their own rate-limit bucket. Vercel overwrites the header, so it needs nothing here.
      ...(process.env.TRUSTED_PROXIES ? { ipAddress: { trustedProxies: process.env.TRUSTED_PROXIES.split(",").map((s) => s.trim()).filter(Boolean) } } : {}),
    },
    // Better Auth's own limits on /api/auth/* (production only), counted in Postgres so every server instance shares
    // them. ChatGPT, Claude and Grok refresh tokens from shared server addresses, so the token rule is raised to
    // a per-credential level; every other path keeps Better Auth's default.
    rateLimit: { enabled: process.env.NODE_ENV === "production", storage: "database", customRules: { "/oauth2/token": { window: 60, max: 500 } } },
    session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
    // Every new browser session is a sign-in the person can review under Security activity in Settings.
    databaseHooks: {
      session: {
        create: {
          after: async (s) => {
            const { recordSecurityEvent } = await import("./security-events");
            await recordSecurityEvent(s.userId, "sign_in", { ip: s.ipAddress ?? null, userAgent: s.userAgent ?? null });
          },
        },
      },
    },
    account: ACCOUNT_OPTIONS,
    // Buffer is the only way in: no passwords, no email sign-up.
    emailAndPassword: { enabled: false },
    // Buffer refresh tokens are single-use, so every refresh goes through bufferAccessToken's lock. These routes
    // would let a signed-in browser refresh outside it. Server calls through auth.api are not affected.
    // update-user is also closed: name and picture come only from Buffer at sign-in, so a person cannot point their
    // picture at an address the server would then fetch.
    disabledPaths: ["/refresh-token", "/get-access-token", "/update-user"],
    plugins: [
      genericOAuth({
        config: [
          {
            providerId: BUFFER_PROVIDER_ID,
            // Each sign-in refreshes the name and picture from Buffer, so earlier accounts (stored with the email as
            // the name) and later Buffer profile changes show correctly.
            overrideUserInfo: true,
            clientId: opts.clientId,
            clientSecret: opts.clientSecret,
            authorizationUrl: AUTHORIZE_URL,
            tokenUrl: TOKEN_URL,
            scopes: SCOPES,
            pkce: true,
            tokenEndpointAuth: { method: opts.clientSecret ? "client_secret_post" : "none" },
            authorizationUrlParams: { prompt: "consent" },
            // Buffer has no userinfo endpoint; the GraphQL account query is the identity.
            getUserInfo: async (tokens) => {
              if (!tokens.accessToken) return null;
              const { account } = await bufferQuery<{ account: { id: string; email: string; name: string | null; avatar: string } }>(
                tokens.accessToken,
                "{ account { id email name avatar } }",
              );
              // Buffer's account name is optional; without one, the part of the email before the @ reads better than the address.
              const name = account.name?.trim() || account.email.split("@")[0];
              // The picture is checked once here, at sign-in, so pages never wait on Gravatar: none means initials.
              const image = await shownPortrait(portraitUrl(account.avatar));
              return { id: account.id, email: account.email, name, image, emailVerified: true };
            },
          },
        ],
      }),
      admin(),
      // The connector: Queue Pilot is the OAuth authorization server for ChatGPT, Claude and Grok.
      jwt(),
      mcp({
        loginPage: "/sign-in",
        consentPage: "/consent",
        resource: mcpResource(opts.baseURL),
        // Older clients still register dynamically; newer ones use Client ID Metadata Documents (cimd below).
        allowDynamicClientRegistration: true,
        allowUnauthenticatedClientRegistration: true,
        // Access tokens verify by signature alone; ten minutes bounds how long one outlives a revoke for endpoints
        // that do not check the approval (the connector itself checks it on every call). Refresh keeps sessions going.
        accessTokenExpiresIn: 600,
      }),
      cimd({ fetchClientMetadataResource, metadataProfile: "mcp-2026-07-28" }),
    ],
  });
}

type Auth = ReturnType<typeof buildAuth>;
let cached: { key: string; auth: Auth } | null = null;

/** The auth instance for the current Buffer keys, or null when the database or keys are not configured yet. */
export async function getAuth(): Promise<Auth | null> {
  if (!hasDatabase()) return null;
  const r = await readConfig();
  if (!r.ok) return null;
  const baseURL = new URL(r.env.BUFFER_REDIRECT_URI).origin;
  const key = `${r.env.BUFFER_CLIENT_ID}|${r.env.BUFFER_CLIENT_SECRET ?? ""}|${baseURL}`;
  if (cached?.key !== key) {
    cached = { key, auth: buildAuth({ clientId: r.env.BUFFER_CLIENT_ID, clientSecret: r.env.BUFFER_CLIENT_SECRET, secret: r.env.SESSION_SECRET, baseURL }) };
  }
  return cached.auth;
}
