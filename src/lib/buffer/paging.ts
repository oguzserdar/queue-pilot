/**
 * @fileoverview Reads a Buffer cursor-paged list up to a page budget and says honestly whether it stopped early, so a
 * caller never presents a partial list as the whole one.
 */

/** One page as Buffer returns it. */
export type Page<T> = { nodes: T[]; hasNextPage: boolean; endCursor: string | null };

/** A list read up to a budget. */
export type Paged<T> = {
  items: T[];
  /** True when Buffer has more than was read. */
  more: boolean;
  /** Pass as `after` to continue where this read stopped; null when there is nothing more or no usable cursor. */
  cursor: string | null;
};

/**
 * Follows pages from `after` until Buffer reports the end, the budget runs out, or a cursor fails to advance.
 *
 * @param fetchPage - Reads one page after a cursor (null for the first)
 * @param maxPages - How many pages to read at most
 * @param after - Where to start; null for the beginning
 * @returns The items read, whether more exist, and the cursor to resume from
 */
export async function readPages<T>(fetchPage: (after: string | null) => Promise<Page<T>>, maxPages: number, after: string | null = null): Promise<Paged<T>> {
  const items: T[] = [];
  let cursor = after;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(cursor);
    items.push(...page.nodes);
    if (!page.hasNextPage) return { items, more: false, cursor: null };
    // A missing or repeated cursor would loop forever or skip items: stop and report that more exist.
    if (!page.endCursor || page.endCursor === cursor) return { items, more: true, cursor: null };
    cursor = page.endCursor;
  }
  return { items, more: true, cursor };
}

/** Turns a GraphQL connection into a Page. */
export function pageOf<T>(conn: { edges: { node: T }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } }): Page<T> {
  return { nodes: conn.edges.map((e) => e.node), hasNextPage: conn.pageInfo.hasNextPage, endCursor: conn.pageInfo.endCursor };
}
