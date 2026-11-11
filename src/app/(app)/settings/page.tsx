import { SettingsView } from "@/components/settings-view";
import { approveMode } from "@/lib/agent-permission";
import { PROVIDERS, postgresAiKeyStore } from "@/lib/ai-key-store";
import { listModels } from "@/lib/ai-models";
import { maskSecret } from "@/lib/secrets";
import { allowanceFor } from "@/lib/judge-model";
import { resetTime } from "@/components/ai-usage";
import { approvedAiApps, getCurrentUser, signedInDevices, signedInProfile, signedInUserId } from "@/lib/current-user";
import { recentSecurityEvents } from "@/lib/security-events";
import { showSecurityEvent } from "@/lib/security-event-words";
import { postgresEchoStore } from "@/lib/echo-store";
import { recentDirectPosts } from "../direct-post-actions";

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

export default async function Page({ searchParams }: { searchParams: Promise<{ openrouter?: string; tab?: string; discord?: string }> }) {
  const { openrouter, tab, discord } = await searchParams;
  const notice = openrouter ? OPENROUTER_RESULT[openrouter] ?? null : null;
  const [{ user }, profile, userId, devices] = await Promise.all([getCurrentUser(), signedInProfile(), signedInUserId(), signedInDevices()]);
  const master = process.env.SETTINGS_KEY;
  // Independent reads, so they run together. The built-in allowance is read alongside and dropped when the person
  // has their own key.
  const [apps, aiKey, security, usage, approve, destinations, posts] = await Promise.all([
    userId ? approvedAiApps() : [],
    userId && master
      ? postgresAiKeyStore(master).get(userId).then(async (k) => {
          if (!k) return null;
          const models = await listModels(k.provider, k.key).then((l) => l.models).catch(() => null);
          return { provider: PROVIDERS[k.provider], masked: maskSecret(k.key), model: k.model, models };
        }).catch((e) => {
          console.error(JSON.stringify({ event: "qp-ai-key-read-failed", message: e instanceof Error ? e.message : String(e) }));
          return undefined;
        })
      : null,
    userId
      ? recentSecurityEvents(userId).then((l) => l.map(showSecurityEvent)).catch((e) => {
          console.error(JSON.stringify({ event: "qp-security-read-failed", message: e instanceof Error ? e.message : String(e) }));
          return null;
        })
      : [],
    userId ? allowanceFor(userId).catch(() => null) : null,
    userId ? approveMode(userId).catch(() => "ask" as const) : ("ask" as const),
    // The Channels tab's own reads: a failure there shows a note on that tab, never takes down the whole page.
    userId ? postgresEchoStore().destinations(userId).catch((e) => { console.error(JSON.stringify({ event: "qp-echo-read-failed", message: e instanceof Error ? e.message : String(e) })); return null; }) : [],
    userId ? recentDirectPosts().catch((e) => { console.error(JSON.stringify({ event: "qp-direct-posts-read-failed", message: e instanceof Error ? e.message : String(e) })); return null; }) : [],
  ]);
  const allowance = aiKey === null && usage && user ? { ...usage, resetsAt: resetTime(user.timeZone) } : null;
  return (
    <SettingsView
      // The OpenRouter callback's notice shows on the AI tab, so it lands there.
      tab={openrouter ? "ai" : discord ? "channels" : tab}
      account={user ? { email: user.email, name: profile?.name ?? user.email, image: profile?.image ?? null, channelNames: user.channels.map((c) => c.name), rateLimit: user.rateLimit, apps, devices, security, aiKey, allowance, notice, approveMode: approve, channelsPanel: destinations && posts ? { channels: user.channels, copies: destinations.map((d) => ({ kind: d.kind, label: d.label })), discordResult: discord ?? null, posts } : undefined } : undefined}
    />
  );
}
