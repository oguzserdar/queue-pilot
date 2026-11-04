import { aiBrand } from "./ai-brand";

const HOST_BRANDS: Record<string, string> = {
  "claude.ai": "Claude", "chatgpt.com": "ChatGPT", "grok.com": "Grok",
  "cursor.com": "Cursor", "www.cursor.com": "Cursor",
};

function parseUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    return url.username || url.password ? null : url;
  } catch { return null; }
}

/** Presentation only, after OAuth validates the registered callback and signed query.
 * A self-declared name alone must never grant a provider logo.
 */
export function consentIdentity(client: string, clientId: string, redirectUri: string) {
  const redirect = parseUrl(redirectUri);
  const metadata = parseUrl(clientId);
  const requested = aiBrand(client);
  const family = requested === "Codex" ? "ChatGPT" : requested === "Claude Code" ? "Claude" : requested;
  const callbackBrand = redirect?.protocol === "https:" && !redirect.port ? HOST_BRANDS[redirect.hostname] : null;
  // URL client IDs are metadata documents validated by the OAuth provider, not DCR client_uri values.
  const metadataBrand = metadata?.protocol === "https:" && !metadata.port ? HOST_BRANDS[metadata.hostname] : null;
  const brand = requested && (callbackBrand === family || metadataBrand === family) ? requested : null;
  const place = returnPlace(redirectUri);
  const destination = place === THIS_COMPUTER ? "Returns you to a program on this computer"
    : place ? `Returns you to ${place.startsWith("The ") ? `the ${place.slice(4)}` : place}`
    : "Return destination unavailable";
  return { brand, destination };
}

const THIS_COMPUTER = "This computer";

/**
 * Where one registered callback sends the person back to, in a few words: a site's host ("grok.com"), "This computer"
 * for a local program, or "The cursor app" for an app link. Null for an address that cannot be read.
 *
 * @param redirectUri - One of the app's registered callback addresses
 * @returns The place, or null
 */
export function returnPlace(redirectUri: string): string | null {
  const redirect = parseUrl(redirectUri);
  if (!redirect) return null;
  if (redirect.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname)) return THIS_COMPUTER;
  if (["https:", "http:"].includes(redirect.protocol)) return redirect.host;
  return `The ${redirect.protocol.slice(0, -1)} app`;
}

/**
 * Every distinct place an approved app can send the person back to, in the order registered, so two connections
 * from the same app can be told apart ("cursor.com" against "This computer").
 *
 * @param redirects - The app's registered callback addresses
 * @returns Distinct places, unreadable addresses left out
 */
export function returnPlaces(redirects: string[]): string[] {
  return [...new Set(redirects.map(returnPlace).filter((p): p is string => p !== null))];
}

/** An approved-app row has no current callback; mixed remote destinations stay unbranded. */
export function approvedClientBrand(client: string, clientId: string, redirects: string[]): string | null {
  const identities = redirects.map((uri) => consentIdentity(client, clientId, uri));
  const brand = identities.find((identity) => identity.brand)?.brand ?? null;
  return brand && identities.every((identity) => identity.brand === brand || identity.destination === "Returns you to a program on this computer") ? brand : null;
}
