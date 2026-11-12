/**
 * Turns the person's edits in Buffer into playbook offers. What Queue Pilot wrote (written-store) is compared with
 * each post's current text in the saved copy of the queue, so finding fixes costs no request to Buffer.
 */
import type { Edit, Fix, FixOffer } from "./fixes";
import { appliesTo, NETWORKS, parseNewRule, type NewRule, type Rule } from "./rules";
import type { Written } from "./written-store";

const same = (a: string, b: string) => a.replace(/\s+/g, " ").trim() === b.replace(/\s+/g, " ").trim();

/** Edits the person made to drafts Queue Pilot wrote, for posts still in the saved copy of the queue. */
export function editsFrom(written: Written[], posts: { id: string; channelId?: string; text: string }[]): Edit[] {
  const now = new Map(posts.map((p) => [p.id, p]));
  return written.flatMap((w) => {
    const post = now.get(w.postId);
    const after = post?.text;
    return after === undefined || same(w.text, after) ? [] : [{ postId: w.postId, ...(post?.channelId ? { channelId: post.channelId } : {}), network: w.network, before: w.text, after }];
  });
}

/** A fix as a rule: a swap or a cut is enforced, an added ending is flagged, on the network the fix was made on. */
export function fixToRule(fix: Fix, network: string, channelId?: string): NewRule {
  const channels = network in NETWORKS ? [network] : "all";
  const raw =
    fix.kind === "replace" ? { kind: "replace", from: fix.from, to: fix.to, channels, level: "block" }
    : fix.kind === "banned" ? { kind: "banned", phrase: fix.phrase, channels, level: "block" }
    : { kind: "ends_with", phrase: fix.phrase, channels, level: "warn" };
  const rule = parseNewRule({ ...raw, ...(channelId ? { accountIds: [channelId] } : {}) });
  if (typeof rule === "string") throw new Error(`A found fix did not make a valid rule: ${rule}`);
  return rule;
}

/** Stable key for an offer, so a "Not now" is remembered. */
export function offerKey(o: FixOffer): string {
  const f = o.fix;
  return `${o.network}|${o.channelId ? `account:${o.channelId}|` : ""}${f.kind}|${f.kind === "replace" ? `${f.from}>${f.to}` : f.phrase.toLowerCase()}`;
}

/** True when an existing rule already covers this fix, on any network. */
function covered(fix: Fix, rules: Rule[]): boolean {
  return rules.some((r) =>
    fix.kind === "replace" ? r.kind === "replace" && r.from.toLowerCase() === fix.from && r.to.toLowerCase() === fix.to
    : fix.kind === "banned" ? r.kind === "banned" && r.phrases.some((p) => p.toLowerCase() === fix.phrase.toLowerCase())
    : r.kind === "ends_with" && r.phrase.toLowerCase() === fix.phrase.toLowerCase(),
  );
}

/** Repeated fixes still worth offering: not a rule yet, and not set aside with Not now. */
export function openOffers(offers: FixOffer[], rules: Rule[], dismissed: Set<string>): FixOffer[] {
  return offers.filter((o) => !covered(o.fix, rules.filter(r => appliesTo(r, o.network, o.channelId))) && !dismissed.has(offerKey(o)));
}
