/**
 * The public origin of this app, as the browser sees it. Every place that builds a URL another service will send the
 * user back to (Discord's redirect_uri, the connector address) uses this one function, so a link and its callback can
 * never disagree behind a proxy.
 */
export function publicOrigin(h: Headers): string {
  const proto = (h.get("x-forwarded-proto") ?? "https").split(",")[0].trim();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  return `${proto}://${host}`;
}

/**
 * This deployment's address as configured (the origin of BUFFER_REDIRECT_URI), for text an AI agent will act on, such
 * as setup commands. Unlike a request's own address, a forged Host header cannot change it. Falls back to the
 * request's origin only when nothing is configured, as on a fresh local copy.
 *
 * @param req - The incoming request, used only for the fallback
 */
export function configuredOrigin(req: Request): string {
  const uri = process.env.BUFFER_REDIRECT_URI;
  try {
    if (uri) return new URL(uri).origin;
  } catch {
    // An invalid value falls through to the request's origin.
  }
  return new URL(req.url).origin;
}
