/**
 * How a person shows in the app. Buffer sends a Gravatar address whose fallback is its stock silhouette; asking
 * Gravatar for a 404 instead lets the avatar components show the person's initials when they have no picture.
 */

/** Gravatar's own host or one of its subdomains, never a look-alike such as evilgravatar.com. */
const isGravatar = (h: string) => h === "gravatar.com" || h.endsWith(".gravatar.com");

/**
 * The picture to show, or undefined for initials.
 *
 * @param src - The image address from Buffer
 */
export function portraitUrl(src: string | null | undefined): string | undefined {
  if (!src) return undefined;
  try {
    const u = new URL(src);
    if (isGravatar(u.hostname)) {
      u.searchParams.set("d", "404");
      u.searchParams.set("s", "96");
    }
    return u.toString();
  } catch {
    return undefined;
  }
}

/**
 * The name to show. A name that is just the start of the email ("oguz", "mark.evans") is turned into words with
 * capitals; anything the person typed themselves is left exactly as written.
 *
 * @param name - The stored name
 * @param email - The account email
 */
export function displayName(name: string, email: string): string {
  const local = email.split("@")[0] ?? "";
  if (name !== local) return name;
  return local.split(/[._-]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(" ") || name;
}

// One answer per address for an hour, shared by concurrent page renders (the promise is stored, not the value).
const checked = new Map<string, { promise: Promise<boolean>; expiresAt: number }>();

/**
 * The picture to render on the server. A Gravatar address is checked first, because an image that fails before the
 * page hydrates never reaches its error handler and shows as a broken image instead of initials.
 *
 * @param src - An address from portraitUrl
 * @param fetchImpl - Injected in tests
 * @returns The address when there is a picture, else undefined for initials
 */
export async function shownPortrait(src: string | undefined, fetchImpl: typeof fetch = fetch): Promise<string | undefined> {
  if (!src || !isGravatar(new URL(src).hostname)) return src;
  const hit = checked.get(src);
  if (hit && Date.now() < hit.expiresAt) return (await hit.promise) ? src : undefined;
  const promise = fetchImpl(src, { method: "HEAD", signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false);
  checked.set(src, { promise, expiresAt: Date.now() + 3_600_000 });
  return (await promise) ? src : undefined;
}

/**
 * The picture to render for a stored user image. Sign-in stores a checked Gravatar address (marked d=404), so it is
 * used as is with no network call; an older, unchecked address is checked once here until the next sign-in.
 *
 * @param stored - The user's image column
 * @returns The address to render, or null for initials
 */
export async function storedPortrait(stored: string | null | undefined): Promise<string | null> {
  const src = portraitUrl(stored);
  if (!src) return null;
  const u = new URL(src);
  const checked = isGravatar(u.hostname) && new URL(stored!).searchParams.get("d") === "404";
  return checked ? src : (await shownPortrait(src)) ?? null;
}
