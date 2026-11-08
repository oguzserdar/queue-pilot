/**
 * @fileoverview The one place the caller's IP address is decided, for every rate limit: ours (clientIp) and Better
 * Auth's, which reads only the private header withClientIp writes. X-Forwarded-For is the only source. Entries left
 * of the trusted hop can be written by the client, so they are never read, and x-real-ip is never a fallback. When
 * no trustworthy address can be found, every such request shares one bucket instead of letting a client pick its own.
 *
 * The operator setting is TRUSTED_PROXY_HOP_COUNT: how many proxies append to X-Forwarded-For. Unset, it is 1 on
 * Vercel (whose edge writes the header itself) and 0 everywhere else, so a self-hosted port reachable directly cannot
 * be spoofed. TRUSTED_PROXIES, when set, wins: the chain is walked from the right past those addresses or CIDR
 * ranges. One invalid entry in it trusts nothing, rather than falling back to the hop count.
 */
import ipaddr from "ipaddr.js";

/** The request header Better Auth reads the resolved address from. withClientIp always overwrites it. */
export const CLIENT_IP_HEADER = "x-qp-client-ip";

/** The shared bucket for requests whose address cannot be trusted. Not an address, so Better Auth shares one too. */
export const UNTRUSTED_CLIENT_IP = "untrusted";

/** Better Auth's advanced.ipAddress: read only the header withClientIp wrote, never the raw forwarding headers. */
export const BETTER_AUTH_IP_ADDRESS = { ipAddressHeaders: [CLIENT_IP_HEADER] };

/** IPv6 addresses are counted by network, the way Better Auth does, so one network cannot rotate through buckets. */
const IPV6_PREFIX = 64;
const MAX_HOPS = 10;

type Env = Record<string, string | undefined>;

/**
 * How many proxies in front of the app append to X-Forwarded-For.
 *
 * @param env - The server's environment
 * @returns When TRUSTED_PROXY_HOP_COUNT is unset, 1 on Vercel and 0 elsewhere; 0 (trust no forwarded header) when it
 *   is not a whole number 0-10
 */
export function trustedProxyHopCount(env: Env = process.env): number {
  const raw = env.TRUSTED_PROXY_HOP_COUNT;
  if (raw === undefined || raw === "") return env.VERCEL === "1" ? 1 : 0;
  return /^\d{1,2}$/.test(raw) && Number(raw) <= MAX_HOPS ? Number(raw) : 0;
}

/** A valid address in the form used as a bucket key: IPv4-mapped IPv6 as IPv4, other IPv6 cut to its /64. */
function canonical(entry: string | undefined): ipaddr.IPv4 | ipaddr.IPv6 | null {
  if (!entry || !ipaddr.isValid(entry)) return null;
  // ipaddr also accepts shorthand such as "127.1"; only the full dotted form counts as IPv4 here.
  if (!entry.includes(":") && !ipaddr.IPv4.isValidFourPartDecimal(entry)) return null;
  return ipaddr.process(entry);
}

function key(ip: ipaddr.IPv4 | ipaddr.IPv6): string {
  if (ip.kind() === "ipv4") return ip.toString();
  const bytes = ip.toByteArray().map((b, i) => (i < IPV6_PREFIX / 8 ? b : 0));
  return ipaddr.fromByteArray(bytes).toNormalizedString();
}

/** The TRUSTED_PROXIES ranges, or null when any entry is invalid, so a typo trusts nothing instead of widening trust. */
function trustedRanges(env: Env): [ipaddr.IPv4 | ipaddr.IPv6, number][] | null {
  const ranges: [ipaddr.IPv4 | ipaddr.IPv6, number][] = [];
  for (const s of (env.TRUSTED_PROXIES ?? "").split(",").map((v) => v.trim()).filter(Boolean)) {
    try {
      if (s.includes("/")) ranges.push(ipaddr.parseCIDR(s));
      else {
        const ip = ipaddr.process(s);
        ranges.push([ip, ip.kind() === "ipv4" ? 32 : 128]);
      }
    } catch {
      return null;
    }
  }
  return ranges;
}

const inRange = (ip: ipaddr.IPv4 | ipaddr.IPv6, [net, bits]: [ipaddr.IPv4 | ipaddr.IPv6, number]) => ip.kind() === net.kind() && ip.match(net as never, bits);

/**
 * The caller's address for rate limiting, decided from X-Forwarded-For only.
 *
 * @param headers - The request's headers
 * @param env - The server's environment (TRUSTED_PROXY_HOP_COUNT, TRUSTED_PROXIES)
 * @returns The address, or UNTRUSTED_CLIENT_IP when the hop count is 0, the chain is shorter than it, or the chosen
 *   entry is not an address
 */
export function clientIp(headers: Headers, env: Env = process.env): string {
  const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((s) => s.trim());
  if (!headers.has("x-forwarded-for")) return UNTRUSTED_CLIENT_IP;
  const ranges = trustedRanges(env);
  if (!ranges) return UNTRUSTED_CLIENT_IP;
  if (ranges.length) {
    for (let i = chain.length - 1; i >= 0; i--) {
      const ip = canonical(chain[i]);
      if (!ip) return UNTRUSTED_CLIENT_IP;
      if (!ranges.some((r) => inRange(ip, r))) return key(ip);
    }
    return UNTRUSTED_CLIENT_IP;
  }
  const hops = trustedProxyHopCount(env);
  if (hops === 0 || chain.length < hops) return UNTRUSTED_CLIENT_IP;
  const ip = canonical(chain[chain.length - hops]);
  return ip ? key(ip) : UNTRUSTED_CLIENT_IP;
}

/**
 * The same request with CLIENT_IP_HEADER set to clientIp's answer, replacing anything the client sent under that
 * name. Every request handed to Better Auth's handler goes through this, so its limiter counts by the same address.
 * The request is rebuilt from its URL, method, headers and body: on the hosting runtime the incoming request comes
 * from another copy of the fetch implementation, and passing it whole to Request throws.
 *
 * @param req - The incoming request
 * @param env - The server's environment
 */
export async function withClientIp(req: Request, env: Env = process.env): Promise<Request> {
  const headers = new Headers(req.headers);
  headers.set(CLIENT_IP_HEADER, clientIp(req.headers, env));
  const body = req.method === "GET" || req.method === "HEAD" ? undefined : await req.arrayBuffer();
  return new Request(req.url, { method: req.method, headers, body });
}
