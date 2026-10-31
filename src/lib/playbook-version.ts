import { createHash } from "node:crypto";
import type { Rule } from "./rules";
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, canonical(v)]));
  return value;
}
/** Evidence/counters do not affect checks; rule contents, scope and inheritance do. */
export function playbookVersion(rules: Rule[]): string {
  return createHash("sha256").update(JSON.stringify(canonical(rules.map(r => {
    const { learnedFrom: _e, ...rest } = r;
    const clean = { ...rest } as Record<string, unknown>;
    delete clean.fixes;
    return clean;
  }).sort((a, b) => String(a.id).localeCompare(String(b.id)))))).digest("hex");
}
