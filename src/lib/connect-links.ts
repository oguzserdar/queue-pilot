/**
 * @fileoverview Small helpers for the Connect screen, kept free of React so they can be tested alone.
 */

/**
 * Cursor's one-click MCP install link: the server config ({"url": ...}) as base64 JSON, in the format Cursor documents
 * at cursor.com/docs/mcp/install-links.
 *
 * @param url - The connector address
 */
export const cursorInstallLink = (url: string): string =>
  `cursor://anysphere.cursor-deeplink/mcp/install?name=${encodeURIComponent("Queue Pilot")}&config=${btoa(JSON.stringify({ url }))}`;

/**
 * "2 min ago", "3 h ago", "4 days ago": short and exact enough to tell a live connection from an old one.
 *
 * @param iso - When the app last called the connector
 * @param now - Current time in milliseconds
 */
export function sinceText(iso: string, now: number): string {
  const min = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.round(h / 24)} days ago`;
}

/** Where a person adds or reconnects channels in Buffer. */
export const BUFFER_CHANNELS_URL = "https://publish.buffer.com/settings/channels";
