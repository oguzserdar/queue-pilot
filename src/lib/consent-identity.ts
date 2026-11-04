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
  const loopback = redirect?.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(redirect.hostname);
  const destination = loopback ? "Returns you to a program on this computer"
    : redirect && ["https:", "http:"].includes(redirect.protocol) ? `Returns you to ${redirect.host}`
    : redirect ? `Returns you to the ${redirect.protocol.slice(0, -1)} app`
    : "Return destination unavailable";
  return { brand, destination };
}

/** An approved-app row has no current callback; mixed remote destinations stay unbranded. */
export function approvedClientBrand(client: string, clientId: string, redirects: string[]): string | null {
  const identities = redirects.map((uri) => consentIdentity(client, clientId, uri));
  const brand = identities.find((identity) => identity.brand)?.brand ?? null;
  return brand && identities.every((identity) => identity.brand === brand || identity.destination === "Returns you to a program on this computer") ? brand : null;
}
