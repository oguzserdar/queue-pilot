/**
 * @fileoverview Buffer's post template library (API reference, read 5 Nov 2026; marked Preview). A template is "a post
 * template used for content inspiration": a title, a short description, an emoji and a body that "may contain
 * {{placeholders}}". The library holds Buffer-curated public templates, the organization's internal ones and the
 * person's private ones. Buffer documents no scope for templates, so access is proven by a real call, not assumed.
 *
 * Why Queue Pilot reads it: the writer can start from a format the person (or Buffer) already trusts and fill its
 * placeholders from the source, while the person's playbook still checks the result. It also shows how a second
 * interface on Buffer's API can reuse the template library instead of keeping its own.
 */
import { bufferQuery } from "./client";
import { pageOf, readPages, type Paged } from "./paging";

type Connection<T> = { edges: { node: T }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

/** Who can see a template: Buffer-curated (public), the whole organization (internal) or only its creator (private). */
export type TemplateVisibility = "public" | "internal" | "private";

/** One template as Queue Pilot shows it. */
export type BufferTemplate = {
  id: string;
  title: string;
  description: string;
  emoji: string;
  body: string;
  visibility: TemplateVisibility;
  organizationId: string;
  updatedAt: string;
};

type Run = typeof bufferQuery;

const TEMPLATE_FIELDS = "id title description emoji body visibility organizationId updatedAt";
/** Buffer does not document a page cap for templates; 50 per page keeps each response small. */
const PAGE = 50;
/** Four pages per read keeps a tool answer readable; the caller continues with the cursor. */
const MAX_PAGES = 4;

/**
 * The templates the person can see in one organization: Buffer's public ones, the organization's internal ones and
 * their own private ones. Buffer pins that scope to the person; a filter can only narrow it. Reads up to a page budget
 * and says when more remain.
 *
 * @param token - The person's Buffer access token
 * @param organizationId - The organization whose internal templates to include
 * @param opts - Optional visibility filter and a cursor to continue from
 * @returns The templates read, whether more exist, and the cursor to continue
 */
export async function listTemplates(token: string, organizationId: string, opts: { visibility?: TemplateVisibility; after?: string | null } = {}, run: Run = bufferQuery): Promise<Paged<BufferTemplate>> {
  return readPages(async (after) => {
    const data = await run<{ postTemplates: Connection<BufferTemplate> }>(token,
      `query PostTemplates($input: PostTemplatesInput!, $first: Int, $after: String) { postTemplates(input: $input, first: $first, after: $after) { edges { node { ${TEMPLATE_FIELDS} } } pageInfo { hasNextPage endCursor } } }`,
      { input: { organizationId, ...(opts.visibility ? { filter: { visibility: opts.visibility } } : {}) }, first: PAGE, after });
    return pageOf(data.postTemplates);
  }, MAX_PAGES, opts.after ?? null);
}

/**
 * One template by id.
 *
 * @param token - The person's Buffer access token
 * @param id - The template id
 * @returns The template, or null when Buffer has none with that id (or the person cannot see it)
 */
export async function getTemplate(token: string, id: string, run: Run = bufferQuery): Promise<BufferTemplate | null> {
  const data = await run<{ postTemplate: BufferTemplate | null }>(token,
    `query PostTemplate($input: PostTemplateInput!) { postTemplate(input: $input) { ${TEMPLATE_FIELDS} } }`,
    { input: { id } });
  return data.postTemplate;
}

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
