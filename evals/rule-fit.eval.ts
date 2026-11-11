/**
 * @fileoverview Live eval of applying playbook rules where they fit, on the production provider path. A rule kept from
 * the author's edits to posts about one project must leave an unrelated post alone, yet still hold on a post about that
 * project; a word swap, a ban, the starting rule and an ending the author set for every post must still be caught, in
 * any language. The writer must put an ending only under the posts it fits, and an every-post ending under every post.
 * Every case must hold in all but one of TRIALS runs.
 *
 * Run: pnpm eval   (key and model from .env.eval.local; skipped without them)
 */
import { describe, expect, it } from "vitest";
import { providerOf } from "../src/lib/ai-key-store";
import { decisionModelFor, modelFor, type AiConfig } from "../src/lib/ai-model";
import { askVerdicts, preferencesFrom } from "../src/lib/confirm-fixes";
import { fixToRule } from "../src/lib/fix-offers";
import type { FixOffer } from "../src/lib/fixes";
import { writeDrafts } from "../src/lib/ai-writer";
import { judgeDrafts } from "../src/lib/judge";
import { parseNewRule, type NewRule, type Rule } from "../src/lib/rules";
import { STARTING_RULE } from "../src/lib/starting-rule";
import { structureRule } from "../src/lib/structure-rule";

const KEY = process.env.QP_EVAL_KEY ?? "";
const PROVIDER = providerOf(KEY);
const CFG: AiConfig | null = PROVIDER && process.env.QP_EVAL_MODEL ? { provider: PROVIDER, key: KEY, model: process.env.QP_EVAL_MODEL } : null;
const TRIALS = Number(process.env.EVAL_TRIALS ?? 3);

const REPO = "https://github.com/oguzserdar/queue-pilot";
const statedLink: Rule = { id: "stated", kind: "guidance", channels: ["twitter"], level: "warn", text: `End posts about qp with "${REPO}".` };
const swap: Rule = { id: "qp", kind: "replace", from: "queue pilot", to: "qp", channels: ["twitter"], level: "block", text: 'Say "qp", never "Queue Pilot".' };
const signOff: Rule = { id: "sign", kind: "ends_with", phrase: "Recipe in the newsletter, link in bio.", channels: "all", level: "warn", text: 'End with "Recipe in the newsletter, link in bio."', addedBy: "you" };

const VALS = "Vals AI tested reasoning effort settings. At their lowest setting, frontier models often keep a majority of their performance at a fraction of the cost.";
const QP_POST = "qp now checks every draft against your rules by meaning, in the draft's own language, before anything reaches Buffer.";
const everyPostAd: Rule = { id: "ad", kind: "ends_with", phrase: "#ad", channels: "all", level: "block", text: 'End every post with "#ad"', addedBy: "you" };
/** A rule kept before rules said which posts they are for: the ending alone, in the default wording. */
const legacyLink = { ...(parseNewRule({ kind: "ends_with", phrase: REPO, channels: ["twitter"], level: "warn" }) as NewRule), id: "legacy" } as Rule;
const hype: Rule = { id: "hype", kind: "banned", phrases: ["game changer"], channels: "all", level: "block", text: 'Never "game changer".' };
const starting = { ...STARTING_RULE, id: "start" } as Rule;
const CASES: { name: string; text: string; network: string; rule: Rule; want: "pass" | "fail" | "not fail" }[] = [
  { name: "a legacy ending with no subject is not failed on an unrelated post", text: VALS, network: "twitter", rule: legacyLink, want: "not fail" },
  { name: "an English ban catches its Turkish translation on an unrelated post", text: "Vals AI'ın yeni testi gerçek bir oyun değiştirici: en düşük ayarda bile modeller performansın çoğunu koruyor.", network: "twitter", rule: hype, want: "fail" },
  { name: "an English ban passes a Turkish post without the phrase", text: "Vals AI akıl yürütme ayarlarını test etti. En düşük ayarda bile modeller performansın çoğunu çok daha ucuza koruyor.", network: "twitter", rule: hype, want: "pass" },
  { name: "an English swap is caught on a Turkish post about the subject", text: "Queue Pilot artık her taslağı Buffer'a gitmeden önce kurallarına göre kontrol ediyor.", network: "twitter", rule: swap, want: "fail" },
  { name: "a ban still holds on an unrelated post", text: `${VALS} A real game changer for anyone paying for tokens.`, network: "twitter", rule: hype, want: "fail" },
  { name: "the starting rule still holds on any topic", text: "Shipping update: our customer Maria is going through a divorce and asked to pause her account, so her posts are on hold. More features next week.", network: "linkedin", rule: starting, want: "fail" },
  { name: "a link rule that states its subject leaves an unrelated post alone", text: VALS, network: "twitter", rule: statedLink, want: "pass" },
  { name: "a link rule that states its subject holds on a post about it", text: QP_POST, network: "twitter", rule: statedLink, want: "fail" },
  { name: "a word swap is still caught on a post about the subject", text: "Queue Pilot now checks every draft against your rules before it reaches Buffer.", network: "twitter", rule: swap, want: "fail" },
  { name: "a word swap passes a post that never names the subject", text: VALS, network: "twitter", rule: swap, want: "pass" },
  { name: "an ending the person set for every post is still required on an unrelated post", text: VALS, network: "twitter", rule: everyPostAd, want: "fail" },
  { name: "an ending the author set for every post is still required on a matching post", text: "Brown butter, sage and a squeeze of lemon turn plain squash ravioli into a weeknight dinner.", network: "instagram", rule: signOff, want: "fail" },
];

describe.skipIf(!CFG)(`applying rules where they fit, ${TRIALS} trials`, () => {
  it("leaves unrelated posts alone and still holds every rule where it fits", async () => {
    const model = modelFor(CFG!);
    const judges = { decider: decisionModelFor(CFG!), explainer: model };
    const results = await Promise.all(
      CASES.map(async (c) => {
        const seen: string[] = [];
        for (let i = 0; i < TRIALS; i++) {
          const v = (await judgeDrafts(judges, [{ slotId: "s", text: c.text, network: c.network }], [c.rule])).get("s")?.[0];
          seen.push(v?.verdict ?? "none");
        }
        return { name: c.name, want: c.want, seen, held: seen.filter((s) => (c.want === "not fail" ? s !== "fail" && s !== "none" : s === c.want)).length };
      }),
    );
    console.log(JSON.stringify(results, null, 2));
    for (const r of results) expect(r.held, `${r.name}: ${r.seen.join(", ")}`).toBeGreaterThanOrEqual(TRIALS - 1);
  }, 240_000);
});

// End to end, the owner's case: the repo link added by hand to two posts about qp, judged by the real confirm step, kept
// as the rule it writes, then checked on an unrelated post and on a post about qp.
const LINKED: FixOffer = {
  fix: { kind: "ends_with", phrase: REPO }, network: "twitter", count: 2,
  examples: [
    { before: "qp v0.9.0 is out. getqueuepilot.com now opens on a home page instead of dropping you straight into the demo.", after: `qp v0.9.0 is out. getqueuepilot.com now opens on a home page instead of dropping you straight into the demo.\n${REPO}` },
    { before: "qp never schedules or publishes on its own. Your AI writes drafts into the empty times in your Buffer week.", after: `qp never schedules or publishes on its own. Your AI writes drafts into the empty times in your Buffer week.\n${REPO}` },
  ],
};

const BOOK = "https://lenapark.com/salt-book";
const BOOKED: FixOffer = {
  fix: { kind: "ends_with", phrase: BOOK }, network: "instagram", count: 2,
  examples: [
    { before: "Salt your pasta water like the sea. Chapter 3 of my cookbook explains why it matters for texture.", after: `Salt your pasta water like the sea. Chapter 3 of my cookbook explains why it matters for texture.\n${BOOK}` },
    { before: "The cookbook's brown butter chapter is the one readers write to me about most.", after: `The cookbook's brown butter chapter is the one readers write to me about most.\n${BOOK}` },
  ],
};
const FAMILY = "Took the kids to the lake this morning. Cold water, warm thermos, nobody wanted to leave.";
const BOOK_POST = "My cookbook has a whole chapter on stock: roast the bones first, then simmer low for six hours.";

describe.skipIf(!CFG)(`an ending added to two posts about one subject, end to end, ${TRIALS} trials`, () => {
  it("becomes a rule for posts about that subject only, for any subject", async () => {
    const model = modelFor(CFG!);
    const judges = { decider: decisionModelFor(CFG!), explainer: model };
    const cases = [{ offer: LINKED, off: VALS, on: QP_POST, net: "twitter" }, { offer: BOOKED, off: FAMILY, on: BOOK_POST, net: "instagram" }];
    const runs: { sentence: string; off: string; on: string }[] = [];
    for (const c of cases) for (let i = 0; i < TRIALS; i++) {
      const [kept] = preferencesFrom([c.offer], await askVerdicts(model, [c.offer]));
      if (!kept) { runs.push({ sentence: "(not offered)", off: "pass", on: "n/a" }); continue; }
      const rule = { ...fixToRule(kept.fix, kept.network, undefined, kept.sentence), id: "r" } as Rule;
      const v = await judgeDrafts(judges, [{ slotId: "off", text: c.off, network: c.net }, { slotId: "on", text: c.on, network: c.net }], [rule]);
      runs.push({ sentence: rule.text, off: v.get("off")?.[0]?.verdict ?? "none", on: v.get("on")?.[0]?.verdict ?? "none" });
    }
    console.log(JSON.stringify(runs, null, 2));
    // The failure being fixed is forcing: an unrelated post must never be failed for lacking the ending. "Unsure" is
    // allowed there (it only flags, never blocks or adds), and the ending must still be asked for where it fits.
    expect(runs.filter((r) => r.off === "fail"), JSON.stringify(runs)).toEqual([]);
    expect(runs.filter((r) => r.on === "fail").length, JSON.stringify(runs)).toBeGreaterThanOrEqual(2 * TRIALS - 1);
  }, 600_000);
});

// The person's sentence read into a typed rule by the same step add_rule uses, then judged: "every" must survive.
describe.skipIf(!CFG)(`an every-post ending read from the person's words, ${TRIALS} trials`, () => {
  it("is still required on an unrelated post", async () => {
    const model = modelFor(CFG!);
    const judges = { decider: decisionModelFor(CFG!), explainer: model };
    const written = parseNewRule({ kind: "guidance", text: "End every post with: #ad", channels: "all", level: "block" }) as NewRule;
    const rule = { ...(await structureRule(model, written)), id: "ad2" } as Rule;
    const seen: string[] = [];
    for (let i = 0; i < TRIALS; i++) seen.push((await judgeDrafts(judges, [{ slotId: "s", text: VALS, network: "twitter" }], [rule])).get("s")?.[0]?.verdict ?? "none");
    console.log(JSON.stringify({ kind: rule.kind, text: rule.text, seen }));
    expect(seen.filter((v) => v === "fail").length, seen.join(", ")).toBeGreaterThanOrEqual(TRIALS - 1);
  }, 240_000);
});

// The writer with two items, one about qp and one AI news story, and a rule that adds an ending. Which item goes to which
// slot is the writer's choice; the draft's sourceKey says which it used. A writer answer that does not fit the draft
// schema is recorded, not hidden, and fails the case: every answer must fit its own schema.
const WRITER_BRIEF = {
  slots: [
    { id: "a", local: "Mon 9:00", channel: "@qp", service: "twitter" },
    { id: "b", local: "Tue 9:00", channel: "@qp", service: "twitter" },
  ],
  material: [
    { key: "release", title: "qp v0.9.0", url: "https://github.com/oguzserdar/queue-pilot/releases/tag/v0.9.0", text: "qp v0.9.0 is out. getqueuepilot.com now opens on a home page instead of dropping you straight into the demo, and every draft is checked against your rules by meaning before it reaches Buffer." },
    { key: "news", title: "Reasoning effort on a budget", url: "https://example.com/vals-reasoning", text: `${VALS} The gap was smallest on coding tasks and largest on long math proofs. Their advice: start at the lowest setting and raise it only for the tasks that need it.` },
  ],
  voice: { note: null, examples: [] },
};
type WriterRun = { slot: string; source: string; text: string }[] | string;

async function writeTrials(rule: Rule): Promise<{ runs: WriterRun[]; drafts: { slot: string; source: string; text: string }[] }> {
  const model = modelFor(CFG!);
  const runs = await Promise.all(Array.from({ length: TRIALS }, () =>
    writeDrafts(model, { ...WRITER_BRIEF, rules: [rule] }).then(
      (ds): WriterRun => ds.map((d) => ({ slot: d.slotId, source: d.sourceKey ?? "", text: d.text })),
      (e): WriterRun => `error: ${e instanceof Error ? e.message : String(e)}`,
    )));
  console.log(JSON.stringify({ rule: rule.text, runs }, null, 2));
  return { runs, drafts: runs.flatMap((r) => (typeof r === "string" ? [] : r)) };
}

describe.skipIf(!CFG)(`the writer and rules that add an ending, ${TRIALS} trials`, () => {
  it("puts an ending typed with no subject only under the post it fits", async () => {
    const { runs, drafts } = await writeTrials(legacyLink);
    const news = drafts.filter((d) => d.source === "news");
    const release = drafts.filter((d) => d.source === "release");
    expect(runs.filter((r) => typeof r === "string"), JSON.stringify(runs)).toEqual([]);
    expect(news.length, JSON.stringify(runs)).toBeGreaterThan(0);
    expect(news.filter((d) => d.text.includes(REPO)), JSON.stringify(runs)).toEqual([]);
    expect(release.filter((d) => d.text.trimEnd().endsWith(REPO)).length, JSON.stringify(runs)).toBeGreaterThanOrEqual(Math.max(1, release.length - 1));
  }, 600_000);

  it("puts an ending the person wrote for every post under every post", async () => {
    const written = parseNewRule({ kind: "guidance", text: "End every post with #ad", channels: "all", level: "block" }) as NewRule;
    const rule = { ...(await structureRule(modelFor(CFG!), written)), id: "ad3" } as Rule;
    const { runs, drafts } = await writeTrials(rule);
    expect(rule.kind, rule.text).toBe("ends_with");
    expect(runs.filter((r) => typeof r === "string"), JSON.stringify(runs)).toEqual([]);
    expect(drafts.length, JSON.stringify(runs)).toBeGreaterThan(0);
    expect(drafts.filter((d) => !d.text.trimEnd().endsWith("#ad")), JSON.stringify(runs)).toEqual([]);
  }, 600_000);

  it("never puts a learned, scoped project link under a post about something else", async () => {
    const { runs, drafts } = await writeTrials({ ...legacyLink, id: "scoped", text: "End posts about qp with the repo link." });
    const news = drafts.filter((d) => d.source === "news");
    expect(runs.filter((r) => typeof r === "string"), JSON.stringify(runs)).toEqual([]);
    expect(news.length, JSON.stringify(runs)).toBeGreaterThan(0);
    expect(news.filter((d) => d.text.includes(REPO)), JSON.stringify(runs)).toEqual([]);
  }, 600_000);
});
