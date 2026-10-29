/**
 * Better Auth answers a rate-limited request with 429 and an X-Retry-After header only. HTTP clients and the AI apps
 * that call the connector read the standard Retry-After (RFC 9110), so the same seconds are copied there.
 */
export function withRetryAfter(res: Response): Response {
  if (res.status !== 429 || res.headers.has("retry-after")) return res;
  const seconds = res.headers.get("x-retry-after");
  if (!seconds) return res;
  const headers = new Headers(res.headers);
  headers.set("retry-after", seconds);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
