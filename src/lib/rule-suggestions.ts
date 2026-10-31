/** User-bound, signed suggestions: keeping one cannot substitute another user's rule or fabricated evidence. */
import { createHmac, timingSafeEqual } from "node:crypto";
import { currentOffers, currentRewrites } from "./read-back";
import { fixToRule } from "./fix-offers";
import { firstRuleKey, channelsByOrganization, pastPosts, proposeFirstRules } from "./day-one-rules";
import { proposeRules } from "./rewrite-rules";
import { askVerdicts, complete, preferencesFrom } from "./confirm-fixes";
import { limit } from "./rate-limit";
import { ASK_DEADLINE_MS, checkKey, postgresVerdictStore } from "./fix-verdicts";
import { listRecentSent } from "./buffer/queries";
import { wroteIds } from "./written-store";
import { postgresRulesStore } from "./rules-store";
import { judgeModelFor } from "./judge-model";
import { parseNewRule, ruleInput, type NewRule } from "./rules";
import type { WriteBuffer } from "./write-slots-for-user";

type Suggestion = { key: string; rule: NewRule; fixes: number; evidence: unknown };
function secret() {
  const key = process.env.SESSION_SECRET;
  if (!key) throw new Error("Rule suggestions are unavailable just now.");
  return key;
}
export function signSuggestion(userId: string, suggestion: Suggestion, now = Date.now()): string {
  const body = Buffer.from(JSON.stringify({ userId, suggestion, expires: now + 3600_000 })).toString("base64url");
  return `${body}.${createHmac("sha256", secret()).update(body).digest("base64url")}`;
}
export function verifySuggestion(userId: string, token: string, now = Date.now()): Suggestion | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || token.length > 60_000) return null;
    const expected = createHmac("sha256", secret()).update(parts[0]).digest();
    const actual = Buffer.from(parts[1], "base64url");
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
    const value = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (value.userId !== userId || !Number.isFinite(value.expires) || value.expires <= now) return null;
    const s = value.suggestion as Suggestion;
    if (!s || typeof s.key !== "string" || s.key.length > 500 || !Number.isInteger(s.fixes) || s.fixes < 0) return null;
    const parsed = parseNewRule(ruleInput(s.rule));
    if (typeof parsed === "string") return null;
    return { ...s, rule: { ...parsed, text: s.rule.text } };
  } catch { return null; }
}

export async function ruleSuggestions(userId: string, mode: "fixes" | "rewrites" | "past_posts", loadBuffer: () => Promise<WriteBuffer>) {
  const store = postgresRulesStore();
  const dismissed = await store.dismissed(userId);
  let suggestions: Suggestion[] = [];
  let note = "";
  if (mode === "fixes") {
    // Code finds the repeats for free. Two matching edits can still be chance or a one-off fact, so a model decides
    // which ones are lasting preferences before any is offered. No repeats, no AI action.
    const candidates = (await currentOffers(userId)).filter(o => !dismissed.has(o.key));
    if (!candidates.length) return { suggestions: [], note: "No fix repeated in two drafts on one network yet." };
    // The same unchanged repeats were checked recently: reuse that answer, with no AI action and no AI rate limit.
    const verdicts = postgresVerdictStore();
    const key = checkKey(candidates);
    const busy = { suggestions: [], note: "Queue Pilot is already checking these repeats. Ask again in a minute." };
    const saved = await verdicts.get(userId, key);
    if (saved?.kind === "busy") return busy;
    let answers = saved?.kind === "answer" ? saved.verdicts : null;
    let jm: Awaited<ReturnType<typeof judgeModelFor>> = null;
    let token: string | null = null;
    if (!answers) {
      const l = await limit("ai", userId);
      if (!l.ok) return { suggestions: [], note: "Too many AI requests just now. Try again in a minute." };
      token = await verdicts.claim(userId, key);
      if (!token) return busy;
      const claimed = token;
      jm = await judgeModelFor(userId).catch(async (e) => { await verdicts.release(userId, key, claimed); throw e; });
      if (!jm) { await verdicts.release(userId, key, claimed); throw new Error("AI learning is unavailable. Check built-in AI or your own key in Settings."); }
    }
    try {
      let unanswered = false;
      if (!answers) {
        answers = await askVerdicts(jm!.judges.explainer, candidates, AbortSignal.timeout(ASK_DEADLINE_MS));
        unanswered = !complete(candidates, answers);
        // Only a complete answer is saved. A failed save only means the next check asks again.
        const keep = unanswered ? verdicts.release(userId, key, token!) : verdicts.put(userId, key, token!, answers);
        await keep.catch((e) => console.error(JSON.stringify({ event: "qp-fix-verdict-save-failed", message: e instanceof Error ? e.message : String(e) })));
      }
      const confirmed = preferencesFrom(candidates, answers);
      suggestions = confirmed.map(o => ({ key: o.key, rule: fixToRule(o.fix, o.network), fixes: o.count, evidence: { fix: o.fix, network: o.network, count: o.count, examples: o.examples, why: o.why } }));
      if (!suggestions.length && unanswered) note = "The AI did not answer every repeat clearly. Ask again to check them again.";
      else if (!suggestions.length) note = `Found ${candidates.length} repeated ${candidates.length === 1 ? "fix" : "fixes"}, but none looked like a lasting preference. One-off facts and chance matches are not offered.`;
    } catch (e) { if (token) await verdicts.release(userId, key, token).catch(() => {}); await jm?.giveBack(); throw e; }
    finally { await jm?.settle(); }
  } else {
    // Gather evidence before reserving an AI action. An empty account costs nothing.
    const rewrites = mode === "rewrites" ? await currentRewrites(userId) : null;
    const b = mode === "past_posts" ? await loadBuffer() : null;
    const sent = b ? (await Promise.all([...channelsByOrganization(b.channels)].map(([org, ids]) => listRecentSent(b.token, org, ids)))).flat() : [];
    if (rewrites && rewrites.rewrites.length < 2) return { suggestions: [], note: "Rewrite at least two Queue Pilot drafts in Buffer first." };
    if (b && !sent.length) return { suggestions: [], note: "Buffer has no sent posts for your channels yet." };
    const jm = await judgeModelFor(userId);
    if (!jm) throw new Error("AI learning is unavailable. Check built-in AI or your own key in Settings.");
    try {
      if (rewrites) {
        suggestions = (await proposeRules(jm.judges.explainer, rewrites.rewrites, rewrites.rules)).map(p => ({ key: firstRuleKey(p.rule), rule: p.rule, fixes: p.evidence.length, evidence: p.evidence }));
      } else if (b) {
        const ours = await wroteIds(userId, ...sent.map(p => p.id));
        const found = await proposeFirstRules(jm.judges.explainer, jm.judges, pastPosts(b.channels, sent.filter(p => !ours.has(p.id))), await store.list(userId));
        suggestions = found.offers.map(p => ({ key: firstRuleKey(p.rule), rule: p.rule, fixes: 0, evidence: p.proof }));
        note = found.skipped.length ? `Not enough posts on: ${found.skipped.join(", ")}.` : "";
      }
    } catch (e) { await jm.giveBack(); throw e; }
    finally { await jm.settle(); }
  }
  const bounded = suggestions.filter(s => !dismissed.has(s.key)).map(s => {
    const serialized = JSON.stringify(s.evidence);
    return serialized.length > 12_000 ? { ...s, evidence: { excerpt: serialized.slice(0, 12_000), truncated: true } } : s;
  });
  return { suggestions: bounded.map(s => ({ ...s, token: signSuggestion(userId, s) })), note };
}

export async function applySuggestion(userId: string, token: string, action: "keep" | "dismiss") {
  const s = verifySuggestion(userId, token);
  if (!s) return { ok: false, message: "That suggestion is invalid or expired. List suggestions again." };
  const store = postgresRulesStore();
  if (action === "dismiss") { await store.dismiss(userId, s.key); return { ok: true, message: "Suggestion dismissed." }; }
  if ((await store.dismissed(userId)).has(s.key)) return { ok: false, message: "That suggestion was dismissed. List suggestions again." };
  const existing = (await store.list(userId)).find(r => r.text === s.rule.text && JSON.stringify(r.channels) === JSON.stringify(s.rule.channels));
  if (existing) return { ok: true, id: existing.id, message: "That rule is already kept." };
  const id = await store.add(userId, { ...s.rule, learnedFrom: s.evidence }, s.fixes);
  return { ok: true, id, message: "Suggestion kept as a playbook rule." };
}
