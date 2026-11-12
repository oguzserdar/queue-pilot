/**
 * @fileoverview Paging long lists by bookmark: newest first, with Newer and Older. A bookmark is the edge row's time,
 * as Postgres writes it, and a tie-breaking key, so a row added while someone reads never shifts a page or repeats a
 * line, and rows recorded in the same millisecond are never skipped. One extra row is read to know whether another
 * page exists.
 */
import { and, asc, desc, eq, gt, lt, or, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";

/** A page of rows, newest first, with bookmarks for the next older and newer pages (null when there is none). */
export type Page<R> = { rows: R[]; older: string | null; newer: string | null };

/** Where to start: `before` a page's `older` bookmark, or `after` its `newer` one; neither opens the newest page. */
export type PageFrom = { before?: string | null; after?: string | null };

/** A timestamptz as Postgres writes it as text, for example 2026-11-10 03:10:12.123456+00. */
const PG_TIME = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d{1,6})?[+-]\d{2}(:\d{2})?$/;

/** True for a time that exists: month 13, day 40 or a 99-hour offset pass the pattern but make Postgres throw. */
function realTime(at: string): boolean {
  const [, y, mo, d, h, mi, s, oh] = at.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})(?:\.\d+)?[+-](\d{2})/) ?? [];
  const day = new Date(Date.UTC(+y, +mo - 1, +d));
  return day.getUTCMonth() === +mo - 1 && day.getUTCDate() === +d && +h < 24 && +mi < 60 && +s < 60 && +oh <= 15;
}

/**
 * Reads a bookmark. The time stays as Postgres text because a JavaScript date drops microseconds.
 *
 * @param mark - A bookmark from a page, or anything from a URL
 * @returns Its time and key, or null when it is not a bookmark
 */
export function readBookmark(mark: string | null | undefined): { at: string; key: string } | null {
  if (!mark || mark.length > 300) return null;
  const cut = mark.indexOf("~");
  const at = mark.slice(0, cut), key = mark.slice(cut + 1);
  if (cut < 1 || !key || !PG_TIME.test(at) || !realTime(at)) return null;
  return { at, key };
}

/** The column as Postgres text, for the bookmark. */
export const timeText = (time: PgColumn) => sql<string>`${time}::text`;

/**
 * Reads one page of a list ordered by a time column and a key.
 *
 * @param opts.time - The time column the list is ordered by
 * @param opts.key - A key unique within the list, the tie-breaker for equal times (a column or an expression)
 * @param opts.from - Where to start; an unreadable bookmark opens the newest page
 * @param opts.limit - Rows per page
 * @param opts.read - Runs the query: the extra condition, the order and the row count to read; returns each row with
 *   its time as text (from {@link timeText}) and its key
 * @returns The page, newest first, and the bookmarks either side
 */
export async function readPage<R>(opts: {
  time: PgColumn;
  key: PgColumn | SQL;
  from: PageFrom;
  limit: number;
  read: (where: SQL | undefined, order: SQL[], count: number) => Promise<{ row: R; at: string; key: string }[]>;
}): Promise<Page<R>> {
  const before = readBookmark(opts.from.before);
  const after = before ? null : readBookmark(opts.from.after);
  const mark = before ?? after;
  const cmp = before ? lt : gt;
  const where = mark
    ? or(cmp(opts.time, sql`${mark.at}::timestamptz`), and(eq(opts.time, sql`${mark.at}::timestamptz`), cmp(opts.key as PgColumn, mark.key)))
    : undefined;
  // Walking newer reads upward from the bookmark, then turns the rows back to newest first.
  const order = after ? [asc(opts.time), asc(opts.key as PgColumn)] : [desc(opts.time), desc(opts.key as PgColumn)];
  const got = await opts.read(where, order, opts.limit + 1);
  const more = got.length > opts.limit;
  const page = after ? got.slice(0, opts.limit).reverse() : got.slice(0, opts.limit);
  const first = page[0], last = page.at(-1);
  const bookmark = (r: (typeof got)[number] | undefined) => (r ? `${r.at}~${r.key}` : null);
  // The side the reader came from always has a page; the far side has one when the extra row came back.
  return {
    rows: page.map((r) => r.row),
    older: (after ? Boolean(last) : more) ? bookmark(last) : null,
    newer: (after ? more : Boolean(before && first)) ? bookmark(first) : null,
  };
}
