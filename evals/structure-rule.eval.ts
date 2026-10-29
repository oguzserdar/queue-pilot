/**
 * @fileoverview Live eval of reading a rule in the person's words into a typed rule, on the production provider path.
 * Each sentence has the reading it should give; every case must hold in all but one of TRIALS runs.
 *
 * Run: pnpm eval   (key and model from .env.eval.local; skipped without them)
 */
import { describe, expect, it } from "vitest";
import { providerOf } from "../src/lib/ai-key-store";
import { modelFor, type AiConfig } from "../src/lib/ai-model";
import type { NewRule } from "../src/lib/rules";
import { structureRule } from "../src/lib/structure-rule";

const KEY = process.env.QP_EVAL_KEY ?? "";
const PROVIDER = providerOf(KEY);
const CFG: AiConfig | null = PROVIDER && process.env.QP_EVAL_MODEL ? { provider: PROVIDER, key: KEY, model: process.env.QP_EVAL_MODEL } : null;
const TRIALS = Number(process.env.EVAL_TRIALS ?? 3);

const CASES: { said: string; expect: Partial<Record<string, unknown>> & { kind: NewRule["kind"] } }[] = [
  { said: "Say stock, never broth.", expect: { kind: "replace", from: "broth", to: "stock" } },
  { said: "Use 'stock' instead of 'broth' for this client.", expect: { kind: "replace", from: "broth", to: "stock" } },
  { said: 'Never start a post with "Excited to share".', expect: { kind: "banned", phrases: ["Excited to share"], where: "start" } },
  { said: "Don't use the word synergy.", expect: { kind: "banned", phrases: ["synergy"] } },
  { said: "End every post with: Recipe in the newsletter, link in bio.", expect: { kind: "ends_with", phrase: "Recipe in the newsletter, link in bio." } },
  { said: "Name the dish in the first line.", expect: { kind: "guidance" } },
  { said: "Keep it warm and practical, never salesy.", expect: { kind: "guidance" } },
];

describe.skipIf(!CFG)(`reading rules in the person's words, ${TRIALS} trials`, () => {
  it("reads each sentence into the right kind, with the words copied exactly", async () => {
    const results = await Promise.all(
      CASES.map(async (c) => {
        let held = 0;
        const seen: string[] = [];
        for (let i = 0; i < TRIALS; i++) {
          const r = await structureRule(modelFor(CFG!), { kind: "guidance", text: c.said, channels: "all", level: "warn" });
          seen.push(JSON.stringify(r));
          if (Object.entries(c.expect).every(([k, v]) => JSON.stringify((r as Record<string, unknown>)[k]) === JSON.stringify(v)) && r.text === c.said) held++;
        }
        return { said: c.said, held, seen: [...new Set(seen)] };
      }),
    );
    for (const r of results) console.log(`${r.held >= TRIALS - 1 ? "PASS" : "FAIL"}  ${r.held}/${TRIALS}  ${r.said}\n      ${r.seen.join("\n      ")}`);
    expect(results.filter((r) => r.held < TRIALS - 1).map((r) => r.said)).toEqual([]);
  });
});
