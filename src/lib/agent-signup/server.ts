/**
 * The deployment's pieces that every agent sign-up route needs: the token signer, the site's own address, the claim-link
 * secret and the key that hashes callers' addresses.
 *
 * Why the secrets are derived, not configured. Queue Pilot already has one server secret that never leaves the
 * environment, SESSION_SECRET (Better Auth signs sessions with it). Each key here is an HMAC of that secret under its
 * own label, so they are independent of each other and of the session signing, and a self-hoster has nothing new to
 * set. The cost: rotating SESSION_SECRET also rotates the claim-link secret, with no fallback, so every live claim
 * link stops working until the agent's next reply carries the new one (claim-link.ts explains the fallback rule this
 * skips). A leaked SESSION_SECRET already calls for exactly that.
 *
 * Why the address is hashed with a key. A plain SHA-256 of an IPv4 address is reversed by hashing all 2^32 of them.
 * An HMAC under a server key cannot be reversed without the key, and still gives the same value for the same address,
 * which is all the per-address limit and abuse review need.
 */
import { createHash, createHmac } from "node:crypto";
import { getAuth } from "../auth";
import type { LinkSecrets } from "./claim-link";
import type { AgentTokenSigner } from "./tokens";

export type AgentServer = {
  signer: AgentTokenSigner;
  /** The site's origin, e.g. https://queue.example. */
  baseURL: string;
  linkSecrets: LinkSecrets;
  /** HMAC of a caller's address, hex. */
  ipHash: (ip: string) => string;
};

const derive = (secret: string, label: string) => createHmac("sha256", secret).update(label).digest("hex");

/** Builds the context from Better Auth's secret and base URL. Exported for tests, which pass their own instance. */
export function agentServerFrom(auth: AgentTokenSigner, secret: string, authBaseURL: string): AgentServer {
  const baseURL = new URL(authBaseURL.replace(/\/api\/auth\/?$/, "")).origin;
  const linkKey = derive(secret, "qp-claim-link-key/v1");
  // The key id names the secret without revealing it, so a link signed before a rotation is recognised as such.
  const linkKeyId = `k${createHash("sha256").update(linkKey).digest("hex").slice(0, 8)}`;
  const ipKey = derive(secret, "qp-agent-ip/v1");
  return {
    signer: auth,
    baseURL,
    linkSecrets: { current: { id: linkKeyId, key: linkKey } },
    ipHash: (ip) => createHmac("sha256", ipKey).update(ip).digest("hex"),
  };
}

/** The context for this deployment, or null when it is not configured yet (no database or no Buffer keys). */
export async function agentServer(): Promise<AgentServer | null> {
  const auth = await getAuth();
  if (!auth) return null;
  const ctx = await auth.$context;
  // The jwt plugin's endpoints, as the slice tokens.ts takes.
  const signer: AgentTokenSigner = {
    api: {
      signJWT: (args) => auth.api.signJWT(args),
      verifyJWT: (args) => auth.api.verifyJWT(args),
      getJwks: () => auth.api.getJwks(),
    },
  };
  return agentServerFrom(signer, ctx.secret, ctx.baseURL);
}
