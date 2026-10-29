/**
 * Fetching addresses that users supply, from our server, without reaching private networks (SSRF).
 * The check runs inside the connection's own DNS lookup, so the socket connects to exactly the address
 * that was checked (a second lookup cannot swap in 127.0.0.1). Redirects are followed by hand, up to
 * MAX_REDIRECTS, and every hop goes through the same guarded connection.
 */
import "server-only";
import { lookup as dnsLookup, type LookupAddress } from "node:dns";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";

const MAX_REDIRECTS = 3;

/** True only for ordinary public addresses; IPv4-mapped IPv6 is unwrapped first. */
export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  return ipaddr.process(address).range() === "unicast";
}

export class BlockedAddressError extends Error {}

type LookupCallback = (err: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;

/** DNS lookup that fails when any resolved address is not public. */
function guardedLookup(hostname: string, options: { all?: boolean }, callback: LookupCallback): void {
  dnsLookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err, []);
    const blocked = addresses.find((a) => !isPublicAddress(a.address));
    if (blocked || addresses.length === 0) return callback(new BlockedAddressError(`${hostname} is not a public address`), []);
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

const agent = new Agent({ connect: { lookup: guardedLookup as never } });

/** GET a user-supplied http(s) URL with the private-network guard. Throws BlockedAddressError on a private target. */
export async function safeFetch(url: URL, init: { headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<Response> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "https:" && current.protocol !== "http:") throw new BlockedAddressError("Only web addresses are allowed");
    // A literal IP never goes through DNS, so it is checked here.
    const host = current.hostname.replace(/^\[|\]$/g, "");
    if (ipaddr.isValid(host) && !isPublicAddress(host)) throw new BlockedAddressError(`${host} is not a public address`);
    const res = (await undiciFetch(current, { ...init, redirect: "manual", dispatcher: agent })) as unknown as Response;
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.body?.cancel();
    current = new URL(location, current);
  }
  throw new BlockedAddressError("Too many redirects");
}
