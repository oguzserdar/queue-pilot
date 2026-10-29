import type { Post } from "./buffer/queries";

/** Posts whose due time falls within [start, end], taken from the snapshot instead of a new Buffer request. */
export function postsBetween(posts: Post[], start: Date, end: Date): Post[] {
  const a = start.getTime();
  const b = end.getTime();
  return posts.filter((p) => {
    if (!p.dueAt) return false;
    const t = Date.parse(p.dueAt);
    return t >= a && t <= b;
  });
}
