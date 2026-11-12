import Link from "next/link";
import styles from "./pager.module.css";

/**
 * Newer and Older links under a long list paged by bookmark (src/lib/page-bookmark.ts). Shows nothing when the list
 * fits on one page. The links keep the page's other query values, so a tab stays open.
 */
export function Pager({ path, query = {}, older, newer, label, hash, names = { before: "before", after: "after" } }: {
  /** The page's path, such as /reviews. */
  path: string;
  /** Other query values to keep, such as { tab: "security" }. */
  query?: Record<string, string>;
  /** Bookmarks from the page; null when there is no page that way. */
  older: string | null;
  newer: string | null;
  /** What the list is, for screen readers: "Security activity pages". */
  label: string;
  /** An anchor to land on, without the #. */
  hash?: string;
  /** The query names for the bookmarks, when two lists share a page. */
  names?: { before: string; after: string };
}) {
  if (!older && !newer) return null;
  const href = (k: "before" | "after", mark: string) => `${path}?${new URLSearchParams({ ...query, [names[k]]: mark })}${hash ? `#${hash}` : ""}`;
  return (
    <nav className={styles.pager} aria-label={label}>
      {newer && <Link className={styles.link} href={href("after", newer)} scroll={false}>Newer</Link>}
      {older && <Link className={styles.link} href={href("before", older)} scroll={false}>Older</Link>}
    </nav>
  );
}
