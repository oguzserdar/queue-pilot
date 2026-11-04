/**
 * Web search and page reading through Exa, for the person's AI to reach context beyond their own feeds. Optional:
 * with no key set the tools say so. Every failure is a status the AI can report, never a thrown error, and the text
 * that comes back is data to quote from, never instructions.
 */
const BASE = "https://api.exa.ai";
const TIMEOUT_MS = 20_000;
/**
 * A request bound, not a coverage choice: far above any page or podcast transcript (a 58-minute episode is about 90,000
 * characters), so it only stops a runaway response. A page that reaches it is reported as cut, never presented as whole.
 */
export const PAGE_CEILING = 1_000_000;
/** Search categories Exa accepts. */
export const CATEGORIES = ["news", "company", "publication", "personal site", "financial report", "people"] as const;
const EXCERPT_CHARS = 600;
const EXCERPTS_PER_HIT = 3;

export type Problem = { status: "not-configured" | "invalid-key" | "out-of-credits" | "rate-limited" | "failed"; message: string };
export type Hit = { title: string; url: string; publishedDate: string | null; author: string | null; excerpts: string[] };
/** The part of Exa's index that holds podcast episodes with full transcripts. */
export const PODCAST_DOMAIN = "exa.ai/library/podcast";
export type SearchInput = { query: string; category?: (typeof CATEGORIES)[number]; numResults?: number; since?: string; domains?: string[]; podcasts?: boolean };
export type Page = { title: string; url: string; text: string; truncated: boolean };

/** The same words for every Exa call, so the AI relays one plain reason. */
function problemFor(status: number): Problem {
  if (status === 401 || status === 403) return { status: "invalid-key", message: "Exa rejected the key." };
  if (status === 402) return { status: "out-of-credits", message: "Exa credits are used up." };
  if (status === 429) return { status: "rate-limited", message: "Exa asked us to wait. Try later." };
  return { status: "failed", message: "Exa could not answer that." };
}

async function post(path: string, body: unknown, apiKey: string, fetchImpl: typeof fetch): Promise<{ problem: Problem } | { json: unknown }> {
  try {
    const res = await fetchImpl(`${BASE}${path}`, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status !== 200) return { problem: problemFor(res.status) };
    return { json: await res.json() };
  } catch (e) {
    console.warn(JSON.stringify({ event: "qp-exa-failed", message: e instanceof Error ? e.message : String(e) }));
    return { problem: { status: "failed", message: "Exa could not be reached." } };
  }
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** A public web address we are willing to fetch and store: http or https, no embedded sign-in details. */
const isWebAddress = (value: string): boolean => {
  try { const u = new URL(value); return (u.protocol === "https:" || u.protocol === "http:") && !u.username && !u.password; } catch { return false; }
};

/** Searches the web. Each hit carries a few short excerpts, not the page: read a page with readPage. */
export async function searchWeb(input: SearchInput, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<{ status: "ready"; results: Hit[] } | Problem> {
  if (!apiKey) return { status: "not-configured", message: "Web search is not set up. The operator adds an Exa key in /admin." };
  const out = await post("/search", {
    query: input.query,
    type: "auto",
    numResults: Math.min(Math.max(input.numResults ?? 5, 1), 8),
    ...(input.category ? { category: input.category } : {}),
    ...(input.since ? { startPublishedDate: input.since } : {}),
    ...(input.podcasts ? { includeDomains: [PODCAST_DOMAIN] } : input.domains?.length ? { includeDomains: input.domains } : {}),
    contents: { highlights: { maxCharacters: EXCERPT_CHARS * EXCERPTS_PER_HIT } },
  }, apiKey, fetchImpl);
  if ("problem" in out) return out.problem;
  const raw = isObject(out.json) ? out.json.results : undefined;
  if (!Array.isArray(raw)) return { status: "failed", message: "Exa could not answer that." };
  const results: Hit[] = [];
  for (const r of raw) {
    if (!isObject(r)) continue;
    const url = str(r.url);
    if (!url || !isWebAddress(url)) continue;
    const excerpts = (Array.isArray(r.highlights) ? r.highlights : []).filter((h): h is string => typeof h === "string").map((h) => h.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, EXCERPTS_PER_HIT).map((h) => h.slice(0, EXCERPT_CHARS));
    results.push({ title: str(r.title) ?? url, url, publishedDate: str(r.publishedDate), author: str(r.author), excerpts });
  }
  return { status: "ready", results };
}

/** Reads one page's complete text, up to PAGE_CEILING, and says when it was cut. A page Exa could not fetch is a problem, never empty text. */
export async function readPage(url: string, apiKey: string, fetchImpl: typeof fetch = fetch): Promise<{ status: "ready"; page: Page } | Problem> {
  if (!apiKey) return { status: "not-configured", message: "Web reading is not set up. The operator adds an Exa key in /admin." };
  if (!isWebAddress(url)) return { status: "failed", message: "Use a public web address that starts with https://." };
  // One more character than we keep, so a page that is exactly PAGE_CEILING long is not reported as cut.
  const out = await post("/contents", { urls: [url], text: { maxCharacters: PAGE_CEILING + 1 } }, apiKey, fetchImpl);
  if ("problem" in out) return out.problem;
  // Vendor JSON is checked, not cast: a null envelope, entry or status is a failed read, never a thrown error.
  const json = isObject(out.json) ? out.json : {};
  const failed = Array.isArray(json.statuses) && json.statuses.some((s) => isObject(s) && s.status === "error");
  const first = Array.isArray(json.results) && isObject(json.results[0]) ? json.results[0] : undefined;
  const raw = typeof first?.text === "string" ? first.text : "";
  const text = raw.replace(/\s+/g, " ").trim();
  if (failed || !first || !text) return { status: "failed", message: "Exa could not read that page." };
  // Cut detection reads the raw reply: Exa stops at PAGE_CEILING + 1 characters, and collapsing whitespace first could
  // shrink that prefix below the ceiling and report a partial page as whole.
  const truncated = raw.length > PAGE_CEILING;
  const returned = str(first.url);
  return { status: "ready", page: { title: str(first.title) ?? url, url: returned && isWebAddress(returned) ? returned : url, text: truncated ? text.slice(0, PAGE_CEILING) : text, truncated } };
}
