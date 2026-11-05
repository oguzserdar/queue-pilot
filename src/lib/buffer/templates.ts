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

type ListOpts = { visibility?: TemplateVisibility; after?: string | null; pageSize?: number; maxPages?: number };

/** Reads one page of templates after a cursor. */
const templatePage = (token: string, organizationId: string, opts: ListOpts, run: Run) => async (after: string | null) => {
  const data = await run<{ postTemplates: Connection<BufferTemplate> }>(token,
    `query PostTemplates($input: PostTemplatesInput!, $first: Int, $after: String) { postTemplates(input: $input, first: $first, after: $after) { edges { node { ${TEMPLATE_FIELDS} } } pageInfo { hasNextPage endCursor } } }`,
    { input: { organizationId, ...(opts.visibility ? { filter: { visibility: opts.visibility } } : {}) }, first: opts.pageSize ?? PAGE, after });
  return pageOf(data.postTemplates);
};

/**
 * The templates the person can see in one organization: Buffer's public ones, the organization's internal ones and
 * their own private ones. Buffer pins that scope to the person; a filter can only narrow it. Reads up to a page budget
 * and says when more remain. The cursor always marks the end of the last page returned, so continuing skips nothing.
 *
 * @param token - The person's Buffer access token
 * @param organizationId - The organization whose internal templates to include
 * @param opts - Optional visibility filter, a cursor to continue from, and the page size and budget
 * @returns The templates read, whether more exist, and the cursor to continue
 */
export async function listTemplates(token: string, organizationId: string, opts: ListOpts = {}, run: Run = bufferQuery): Promise<Paged<BufferTemplate>> {
  return readPages(templatePage(token, organizationId, opts, run), opts.maxPages ?? MAX_PAGES, opts.after ?? null);
}

/**
 * Templates whose title or description contains `search` (any case), read page by page until `limit` matches or the
 * page budget. Each page asks for no more templates than there is room for, so the answer never exceeds `limit`; every
 * match on the pages read is returned, and the cursor marks the end of the last page read, so continuing the same
 * search never skips a template.
 *
 * @param token - The person's Buffer access token
 * @param organizationId - The organization whose internal templates to include
 * @param search - Text to look for in titles and descriptions
 * @param opts - Visibility filter, cursor, page size, page budget, and how many matches are enough
 * @returns The matches, whether Buffer has more templates to search, the cursor, and how many templates were looked at
 */
export async function searchTemplates(token: string, organizationId: string, search: string, opts: ListOpts & { limit?: number } = {}, run: Run = bufferQuery): Promise<Paged<BufferTemplate> & { scanned: number }> {
  const want = search.toLowerCase();
  const size = opts.pageSize ?? PAGE;
  const limit = opts.limit ?? Infinity;
  const items: BufferTemplate[] = [];
  let cursor = opts.after ?? null;
  let scanned = 0;
  for (let i = 0; i < (opts.maxPages ?? MAX_PAGES); i++) {
    const page = await templatePage(token, organizationId, { ...opts, pageSize: Math.min(size, limit - items.length) }, run)(cursor);
    scanned += page.nodes.length;
    items.push(...page.nodes.filter((t) => `${t.title} ${t.description}`.toLowerCase().includes(want)));
    if (!page.hasNextPage) return { items, more: false, cursor: null, scanned };
    if (!page.endCursor || page.endCursor === cursor) return { items, more: true, cursor: null, scanned };
    cursor = page.endCursor;
    if (items.length >= limit) break;
  }
  return { items, more: true, cursor, scanned };
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

export { fillTemplate, placeholdersIn } from "../placeholders";
