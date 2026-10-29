/**
 * Minimal Buffer GraphQL client (https://api.buffer.com, Bearer token).
 * Surfaces Buffer's own error messages and reads Buffer's RateLimit headers on every response
 * (https://developers.buffer.com/guides/api-limits: rolling 15-minute, 24-hour and 30-day windows).
 * On HTTP 429 a short Retry-After gets one retry; a long one (the daily window) fails at once with the reset time,
 * so a page never stalls waiting for a window that will not reopen in time.
 */
export const API_URL = "https://api.buffer.com";

export class BufferApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "BufferApiError";
  }
}

/** Thrown when Buffer's limit is used up and will not reopen within maxWaitMs. */
export class BufferRateLimitedError extends BufferApiError {
  constructor(readonly retryAt: Date) {
    super(`Buffer's request limit is used up until ${retryAt.toISOString()}`, 429);
    this.name = "BufferRateLimitedError";
  }
}

/** One window from Buffer's RateLimit header, e.g. "100-in-15min";r=98;t=897. */
export type RateLimitWindow = { policy: string; remaining: number; resetSeconds: number };

/** Parses every window in a RateLimit header; unknown or malformed entries are skipped. */
export function parseRateLimit(header: string | null): RateLimitWindow[] {
  if (!header) return [];
  return header.split(/,(?=\s*")/).flatMap((entry) => {
    const policy = entry.match(/"([^"]+)"/)?.[1];
    const r = entry.match(/;\s*r=(\d+)/)?.[1];
    const t = entry.match(/;\s*t=(\d+)/)?.[1];
    return policy && r !== undefined && t !== undefined ? [{ policy, remaining: Number(r), resetSeconds: Number(t) }] : [];
  });
}

/**
 * Milliseconds to wait from a Retry-After header. RFC 9110 allows seconds or an HTTP date; Buffer documents seconds.
 * Missing or unreadable values fall back to 60 seconds rather than retrying at once.
 */
export function retryAfterMs(header: string | null, now: number): number {
  const fallback = 60_000;
  if (!header) return fallback;
  if (/^\s*\d+\s*$/.test(header)) return Number(header) * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? fallback : Math.max(0, at - now);
}

/** Buffer's own error text from a failed response body, when there is one. */
async function errorDetail(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { errors?: { message?: string }[]; error?: string };
    const messages = body.errors?.map((e) => e.message).filter(Boolean) ?? [];
    return messages.length ? messages.join("; ") : body.error ?? "";
  } catch {
    return "";
  }
}

type Fetch = typeof fetch;
type Opts = {
  fetchImpl?: Fetch;
  sleep?: (ms: number) => Promise<void>;
  maxWaitMs?: number;
  /** Called with Buffer's current windows after every response, so callers can slow down before a 429. */
  onRateLimit?: (windows: RateLimitWindow[]) => void;
  now?: () => number;
};

/** Runs one GraphQL query or mutation and returns its data. */
export async function bufferQuery<T>(token: string, query: string, variables?: Record<string, unknown>, opts: Opts = {}): Promise<T> {
  const doFetch = opts.fetchImpl ?? fetch;
  const sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const maxWait = opts.maxWaitMs ?? 5_000;
  const now = opts.now ?? Date.now;

  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await doFetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });
    const windows = parseRateLimit(res.headers.get("ratelimit"));
    if (windows.length) opts.onRateLimit?.(windows);
    if (res.status === 429) {
      const waitMs = retryAfterMs(res.headers.get("retry-after"), now());
      if (attempt > 0 || waitMs > maxWait) throw new BufferRateLimitedError(new Date(now() + waitMs));
      await sleep(waitMs);
      continue;
    }
    if (res.status === 401) throw new BufferApiError("Buffer sign-in expired or was revoked", 401);
    if (!res.ok) {
      const detail = await errorDetail(res);
      throw new BufferApiError(`Buffer API returned ${res.status}${detail ? `: ${detail}` : ""}`, res.status);
    }
    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
    if (json.errors?.length) throw new BufferApiError(json.errors.map((e) => e.message).join("; "), 200);
    if (!json.data) throw new BufferApiError("Buffer API returned no data", 200);
    return json.data;
  }
  throw new BufferApiError("Buffer request failed after retrying", 429);
}
