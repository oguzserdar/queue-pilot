/**
 * @fileoverview Template placeholders such as {{feature}}: find them and fill them. Browser-safe (no imports), so the
 * composer can list what is still unfilled while the person types.
 */

const PLACEHOLDER = /\{\{\s*([^{}]+?)\s*\}\}/g;

/**
 * The distinct placeholder names in a template body, in the order they first appear.
 *
 * @param body - A template body such as "Shipped {{feature}}. Try it: {{ link }}"
 * @returns ["feature", "link"]
 */
export function placeholdersIn(body: string): string[] {
  const seen = new Set<string>();
  for (const m of body.matchAll(PLACEHOLDER)) seen.add(m[1]);
  return [...seen];
}

/**
 * Fills a template's placeholders. A placeholder with no value stays as written, so a half-filled draft never looks
 * finished: the caller lists what is still missing.
 *
 * @param body - The template body
 * @param values - Placeholder name to text; names match exactly, ignoring spaces inside the braces
 * @returns The filled text and the placeholders still missing a value
 */
export function fillTemplate(body: string, values: Record<string, string>): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = body.replace(PLACEHOLDER, (whole, name: string) => {
    // Only the caller's own string values count: a placeholder named "constructor" must not pick up a built-in.
    const own = Object.prototype.hasOwnProperty.call(values, name) ? values[name] : undefined;
    const v = typeof own === "string" ? own.trim() : "";
    if (v) return v;
    missing.add(name);
    return whole;
  });
  return { text, missing: [...missing] };
}
