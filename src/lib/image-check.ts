/**
 * Server-only pre-flight check that the post's image link really serves an image. It fetches a user-supplied
 * address, so it goes through safeFetch (no private networks) and never ships to the browser.
 */
import "server-only";
import type { Check } from "./preflight";
import { BlockedAddressError, safeFetch } from "./safe-fetch";

type Fetch = typeof fetch;

/**
 * Opens an image link the way a publisher would, without downloading the whole file.
 * Fails on errors, non-image responses and timeouts; share pages (e.g. a cloud-drive viewer) return HTML and fail here.
 */
export async function imageLinkCheck(url: string, opts: { fetchImpl?: Fetch; timeoutMs?: number } = {}): Promise<Check> {
  const name = "Image link loads";
  const doFetch: Fetch = opts.fetchImpl ?? ((u, i) => safeFetch(new URL(String(u)), { headers: i?.headers as Record<string, string>, signal: i?.signal ?? undefined }));
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { name, result: "fail", detail: "The image link is not a valid web address." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return { name, result: "fail", detail: "The image link must start with https://." };
  try {
    const res = await doFetch(parsed, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    });
    await res.body?.cancel();
    // Some hosts turn away automated checks (401/403/429) yet serve the image to the networks: that cannot be told
    // apart from here, so it warns instead of blocking. Anything else that is not OK really is broken.
    if (res.status === 401 || res.status === 403 || res.status === 429) return { name, result: "warn", detail: `The image host refused Queue Pilot's check (${res.status}). It may still load for the network; open the link to be sure.` };
    if (!res.ok) return { name, result: "fail", detail: `The image link answered ${res.status}, so the network would not be able to load it.` };
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) {
      return { name, result: "fail", detail: `The link opens a ${type.split(";")[0] || "page"}, not an image. Use a direct link to the image file.` };
    }
    return { name, result: "pass", detail: "The image loads." };
  } catch (err) {
    if (err instanceof BlockedAddressError) return { name, result: "fail", detail: "The image link points to a private network address. Use a public link to the image." };
    return { name, result: "warn", detail: "The image link did not answer Queue Pilot in time. Open it to check it loads." };
  }
}
