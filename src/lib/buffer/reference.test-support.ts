/**
 * @fileoverview Buffer's published API reference, for tests that check our queries use only documented fields.
 *
 * Buffer's API terms do not allow its API documentation to be put under an open-source license, so this repository
 * does not keep a copy. The tests download https://developers.buffer.com/reference.md into node_modules/.cache (never
 * committed) and reuse it for a day; with no network they use the cached copy, and with neither they fail and say so.
 */
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const URL = "https://developers.buffer.com/reference.md";
const CACHE = join(process.cwd(), "node_modules/.cache/queue-pilot/buffer-api-reference.md");
const DAY = 86_400_000;

let loaded: Promise<string> | null = null;

async function fetchReference(): Promise<string> {
  const fresh = (() => { try { return Date.now() - statSync(CACHE).mtimeMs < DAY; } catch { return false; } })();
  if (fresh) return readFileSync(CACHE, "utf8");
  try {
    const res = await fetch(URL, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes("\n#### Post\n")) throw new Error("the page no longer has a Post type section");
    mkdirSync(join(CACHE, ".."), { recursive: true });
    writeFileSync(CACHE, text);
    return text;
  } catch (e) {
    try { return readFileSync(CACHE, "utf8"); } catch {
      throw new Error(`Could not download Buffer's API reference (${URL}): ${(e as Error).message}. These tests need it once; connect and run them again.`);
    }
  }
}

/** The reference text, downloaded at most once per test run. */
export function bufferReference(): Promise<string> {
  loaded ??= fetchReference();
  return loaded;
}

/** The section documenting one type ("#### Post" up to the next "#### "). Throws when the type is not documented. */
export function typeSection(reference: string, type: string): string {
  const start = reference.indexOf(`\n#### ${type}\n`);
  if (start < 0) throw new Error(`type ${type} not in the reference`);
  const next = reference.indexOf("\n#### ", start + 6);
  return reference.slice(start, next < 0 ? undefined : next);
}

/** The field names documented on one type. */
export function documentedFields(reference: string, type: string): Set<string> {
  return new Set([...typeSection(reference, type).matchAll(/^- `(\w+)`:/gm)].map((m) => m[1]));
}
