/**
 * Buffer's OAuth endpoints and the scopes Queue Pilot asks for (https://developers.buffer.com, authorization code + PKCE).
 * The flow itself (PKCE, token exchange, single-use refresh tokens) is run by Better Auth's generic OAuth plugin
 * (src/lib/auth.ts); concurrent refreshes are serialized in src/lib/buffer-token.ts.
 */
export const AUTHORIZE_URL = "https://auth.buffer.com/auth";
export const TOKEN_URL = "https://auth.buffer.com/token";
export const SCOPES = ["posts:read", "posts:write", "ideas:read", "ideas:write", "account:read", "offline_access"];
