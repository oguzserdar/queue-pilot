import type { ComponentProps } from "react";
import { SettingsView } from "@/components/settings-view";
import { listSocialAccounts } from "@/lib/social-accounts";
import { listAutomations } from "@/lib/reply-automation-store";
import { approveMode } from "@/lib/agent-permission";
import { PROVIDERS, postgresAiKeyStore } from "@/lib/ai-key-store";
import { listModels } from "@/lib/ai-models";
import { maskSecret } from "@/lib/secrets";
import { allowanceFor } from "@/lib/judge-model";
import { resetTime } from "@/components/ai-usage";
import { approvedAiApps, getCurrentUser, signedInDevices, signedInProfile, signedInUserId } from "@/lib/current-user";
import { securityEventPage } from "@/lib/security-events";
import { showSecurityEvents } from "@/lib/security-event-words";
import { postgresEchoStore } from "@/lib/echo-store";
import { recentDirectPosts } from "../direct-post-actions";
import { adminGrantedApps } from "@/lib/admin-operations";

/** What the OpenRouter round trip came back with (src/app/api/openrouter/callback), in words. */
const OPENROUTER_RESULT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "OpenRouter connected. Your drafts now run on your OpenRouter account." },
  expired: { ok: false, text: "That OpenRouter sign-in expired or did not match. Try Connect again." },
  "signed-out": { ok: false, text: "Sign in with Buffer first, then connect OpenRouter." },
  "no-models": { ok: false, text: "Your OpenRouter key cannot use a model that returns structured output." },
  "not-set-up": { ok: false, text: "This copy of Queue Pilot cannot store keys yet (SETTINGS_KEY is not set)." },
  failed: { ok: false, text: "OpenRouter did not finish connecting. Try again." },
  slow: { ok: false, text: "Too many connection attempts in the last hour. Try again later." },
};

type Search = { openrouter?: string; tab?: string; discord?: string; mastodon?: string; before?: string; after?: string; postsBefore?: string; postsAfter?: string };

/** Logs a failed read by its event name; the page shows a note for that part instead of failing. */
const logFailed = (event: string, e: unknown) => console.error(JSON.stringify({ event, message: e instanceof Error ? e.message : String(e) }));
/** A read that may fail on its own: logged, and null for its tab to show a note. */
const orNull = <T,>(read: Promise<T>, event: string): Promise<T | null> => read.catch((e) => { logFailed(event, e); return null; });

/** The person's own AI key, masked, with the models it can use; null without a key, undefined when it could not be read. */
async function readAiKey(userId: string, master: string) {
  return postgresAiKeyStore(master).get(userId).then(async (k) => {
    if (!k) return null;
    const models = await listModels(k.provider, k.key).then((l) => l.models).catch(() => null);
    return { provider: PROVIDERS[k.provider], masked: maskSecret(k.key), model: k.model, models };
  }).catch((e) => {
    logFailed("qp-ai-key-read-failed", e);
    return undefined;
  });
}

/**
 * Everything Settings reads for a signed-in person. Independent reads, so they run together. The built-in allowance is
 * read alongside and dropped when the person has their own key.
 */
async function signedInReads(userId: string, q: Search) {
  const master = process.env.SETTINGS_KEY;
  const [apps, aiKey, security, usage, approve, destinations, posts, socialAccounts, automations] = await Promise.all([
    approvedAiApps(),
    master ? readAiKey(userId, master) : null,
    orNull(securityEventPage(userId, { before: q.before, after: q.after }).then((p) => ({ lines: showSecurityEvents(p.events), older: p.older, newer: p.newer })), "qp-security-read-failed"),
    allowanceFor(userId).catch(() => null),
    approveMode(userId).catch(() => "ask" as const),
    // The Channels tab's own reads: a failure there shows a note on that tab, never takes down the whole page.
    orNull(postgresEchoStore().destinations(userId), "qp-echo-read-failed"),
    orNull(recentDirectPosts({ before: q.postsBefore, after: q.postsAfter }), "qp-direct-posts-read-failed"),
    orNull(listSocialAccounts(userId), "qp-social-accounts-read-failed"),
    orNull(listAutomations(userId), "qp-automations-read-failed"),
  ]);
  return { apps, aiKey, security, usage, approve, destinations, posts, socialAccounts, automations };
}

type Reads = Awaited<ReturnType<typeof signedInReads>>;

/** What a page without a signed-in person reads: nothing, so every part shows as empty rather than failed. */
const SIGNED_OUT: Reads = { apps: [], aiKey: null, security: { lines: [], older: null, newer: null }, usage: null, approve: "ask", destinations: [], posts: { rows: [], older: null, newer: null }, socialAccounts: [], automations: [] };

/** The tab to open: a callback's notice lands on its own tab (OpenRouter on AI, Discord and Mastodon on Channels). */
function openTab(q: Search): string | undefined {
  if (q.openrouter) return "ai";
  return q.discord || q.mastodon ? "channels" : q.tab;
}

type Account = NonNullable<ComponentProps<typeof SettingsView>["account"]>;

/** Settings' view of the signed-in account: who they are, their reads, and what each tab shows. */
function settingsAccount({ user, profile, devices, adminApps, notice, allowance, reads, query }: {
  user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>["user"]>;
  profile: Awaited<ReturnType<typeof signedInProfile>>;
  devices: Awaited<ReturnType<typeof signedInDevices>>;
  adminApps: string[] | undefined;
  notice: { ok: boolean; text: string } | null;
  allowance: Account["allowance"];
  reads: Reads;
  query: Search;
}): Account {
  const { apps, aiKey, security, approve, destinations, posts, socialAccounts, automations } = reads;
  const { discord, mastodon } = query;
  return { email: user.email, name: profile?.name ?? user.email, image: profile?.image ?? null, channelNames: user.channels.map((c) => c.name), rateLimit: user.rateLimit, apps, adminApps, devices, security: security ? security.lines : security, securityPages: security ? { older: security.older, newer: security.newer } : undefined, aiKey, allowance, notice, approveMode: approve, channelsPanel: destinations && posts ? { noBuffer: user.noBuffer, channels: user.channels, copies: destinations.map((d) => ({ kind: d.kind, label: d.label })), discordResult: discord ?? null, posts: posts.rows, postPages: { older: posts.older, newer: posts.newer } } : undefined, socialAccounts, automations: automations ? automations.map(({ createdAt: _c, ...a }) => a) : null, mastodonResult: mastodon ?? null };
}

export default async function Page({ searchParams }: { searchParams: Promise<Search> }) {
  const query = await searchParams;
  const { openrouter } = query;
  const notice = openrouter ? OPENROUTER_RESULT[openrouter] ?? null : null;
  const [{ user }, profile, userId, devices] = await Promise.all([getCurrentUser(), signedInProfile(), signedInUserId(), signedInDevices()]);
  const reads = userId ? await signedInReads(userId, query) : SIGNED_OUT;
  // Only the admin sees which connections may run admin actions; a failed read hides the control rather than guessing.
  const adminApps = userId && profile?.isAdmin ? await adminGrantedApps(userId).catch((e) => {
    logFailed("qp-admin-grants-read-failed", e);
    return undefined;
  }) : undefined;
  const allowance = reads.aiKey === null && reads.usage && user ? { ...reads.usage, resetsAt: resetTime(user.timeZone) } : null;
  return (
    <SettingsView
      // The OpenRouter callback's notice shows on the AI tab, so it lands there.
      tab={openTab(query)}
      account={user ? settingsAccount({ user, profile, devices, adminApps, notice, allowance, reads, query }) : undefined}
    />
  );
}
