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

/** Reads a body in chunks; the feed reader stops as soon as it has read too much. */
export type ChunkReader = {
  read(): Promise<{ done: true; value?: Uint8Array } | { done: false; value: Uint8Array }>;
  cancel(): Promise<void>;
};

/**
 * A server's answer, typed by what our callers read from it and nothing more. Both undici's Response (what these
 * functions return) and the global Response (what tests and `fetch` give) fit it as they are, so neither is cast into
 * the other. `json()` gives `unknown`, so every caller checks the shape it reads.
 */
export type HttpAnswer = {
  status: number;
  ok: boolean;
  headers: { get(name: string): string | null };
  json(): Promise<unknown>;
  text(): Promise<string>;
  body: { cancel(): Promise<void>; getReader(): ChunkReader } | null;
};

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

const agent = new Agent({ connect: { lookup: guardedLookup } });

/** GET a user-supplied http(s) URL with the private-network guard. Throws BlockedAddressError on a private target. */
export async function safeFetch(url: URL, init: { headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<HttpAnswer> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (current.protocol !== "https:" && current.protocol !== "http:") throw new BlockedAddressError("Only web addresses are allowed");
    // A literal IP never goes through DNS, so it is checked here.
    const host = current.hostname.replace(/^\[|\]$/g, "");
    if (ipaddr.isValid(host) && !isPublicAddress(host)) throw new BlockedAddressError(`${host} is not a public address`);
    const res: HttpAnswer = await undiciFetch(current, { ...init, redirect: "manual", dispatcher: agent });
    const location = res.headers.get("location");
    if (res.status < 300 || res.status >= 400 || !location) return res;
    await res.body?.cancel();
    current = new URL(location, current);
  }
  throw new BlockedAddressError("Too many redirects");
}

/**
 * A redirect answer to a write is refused: following it would send the person's credentials to a host they never
 * chose. The body is dropped.
 *
 * @returns The response unchanged when it is not a redirect
 * @throws BlockedAddressError for any 3xx answer
 */
export async function refuseRedirect(res: HttpAnswer): Promise<HttpAnswer> {
  if (res.status >= 300 && res.status < 400) {
    await res.body?.cancel();
    throw new BlockedAddressError("The server answered with a redirect, so nothing was sent to the new address");
  }
  return res;
}

/**
 * POSTs to a server the person chose (their Mastodon instance, their Bluesky server) with the private-network guard:
 * https only, never a private or metadata address, never a redirect. For writes that carry the person's credentials.
 *
 * @param url - The server's address; must be https
 * @param init - Headers (credentials included), the body and an optional abort signal
 * @returns The server's response
 * @throws BlockedAddressError when the address is not public https or the server redirects
 */
export async function safePost(url: URL, init: { headers?: Record<string, string>; body: string; signal?: AbortSignal }): Promise<HttpAnswer> {
  if (url.protocol !== "https:") throw new BlockedAddressError("Only https addresses are allowed for posting");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(host) && !isPublicAddress(host)) throw new BlockedAddressError(`${host} is not a public address`);
  const res: HttpAnswer = await undiciFetch(url, { method: "POST", ...init, redirect: "manual", dispatcher: agent });
  return refuseRedirect(res);
}

/**
 * GETs from a server the person chose with their credentials attached, under the same guard as safePost: https only,
 * never a private or metadata address, never a redirect (a redirect would carry the credentials to a host they never
 * chose). For reads like a person's own notifications; plain public pages use safeFetch.
 *
 * @param url - The server's address; must be https
 * @param init - Headers (credentials included) and an optional abort signal
 * @returns The server's response
 * @throws BlockedAddressError when the address is not public https or the server redirects
 */
export async function safeGet(url: URL, init: { headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<HttpAnswer> {
  if (url.protocol !== "https:") throw new BlockedAddressError("Only https addresses are allowed with credentials");
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(host) && !isPublicAddress(host)) throw new BlockedAddressError(`${host} is not a public address`);
  const res: HttpAnswer = await undiciFetch(url, { method: "GET", ...init, redirect: "manual", dispatcher: agent });
  return refuseRedirect(res);
}
