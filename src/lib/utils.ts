/** Joins class names, skipping empty values. Used by the vendored animated icons. */
export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}
