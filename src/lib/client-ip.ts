/**
 * The caller's IP address for rate limiting. On Vercel x-forwarded-for holds one address that Vercel set. Behind a
 * proxy that appends (a reverse proxy in front of Docker), the chain is walked from the right past the addresses in
 * TRUSTED_PROXIES, the way Better Auth does it; the leftmost entry is never trusted, since a client can write it.
 */
export function clientIp(headers: Headers, trusted: string[] = (process.env.TRUSTED_PROXIES ?? "").split(",").map((s) => s.trim()).filter(Boolean)): string {
  const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (chain.length === 1) return chain[0];
  for (let i = chain.length - 1; i >= 0; i--) if (!trusted.includes(chain[i])) return chain[i];
  return headers.get("x-real-ip")?.trim() || "unknown";
}
