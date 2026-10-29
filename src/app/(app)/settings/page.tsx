import { SettingsView } from "@/components/settings-view";
import { PROVIDERS, postgresAiKeyStore } from "@/lib/ai-key-store";
import { listModels } from "@/lib/ai-models";
import { maskSecret } from "@/lib/secrets";
import { allowanceFor } from "@/lib/judge-model";
import { resetTime } from "@/components/ai-usage";
import { approvedAiApps, getCurrentUser, signedInDevices, signedInProfile, signedInUserId } from "@/lib/current-user";
import { deviceName } from "@/lib/device-name";
import { recentSecurityEvents, type SecurityEvent } from "@/lib/security-events";
import type { ShownSecurityEvent } from "@/components/settings-view";

/** Words for one security event, dated in UTC on the server so the page never shifts between renders. */
function shown(e: SecurityEvent): ShownSecurityEvent {
  const what = e.event === "sign_in" ? "Signed in" : e.event === "app_revoked" ? `Removed ${e.detail?.app ?? "an AI app"}` : "Account deleted";
  const where = [e.userAgent ? deviceName(e.userAgent) : null, e.ip].filter(Boolean).join(", ") || null;
  const when = new Date(e.createdAt).toLocaleString("en-GB", { timeZone: "UTC", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) + " UTC";
  return { what, where, when };
}

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

export default async function Page({ searchParams }: { searchParams: Promise<{ openrouter?: string; tab?: string }> }) {
  const { openrouter, tab } = await searchParams;
  const notice = openrouter ? OPENROUTER_RESULT[openrouter] ?? null : null;
  const [{ user }, profile, userId, devices] = await Promise.all([getCurrentUser(), signedInProfile(), signedInUserId(), signedInDevices()]);
  const master = process.env.SETTINGS_KEY;
  // Independent reads, so they run together. The built-in allowance is read alongside and dropped when the person
  // has their own key.
  const [apps, aiKey, security, usage] = await Promise.all([
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
      ? recentSecurityEvents(userId).then((l) => l.map(shown)).catch((e) => {
          console.error(JSON.stringify({ event: "qp-security-read-failed", message: e instanceof Error ? e.message : String(e) }));
          return null;
        })
      : [],
    userId ? allowanceFor(userId).catch(() => null) : null,
  ]);
  const allowance = aiKey === null && usage && user ? { ...usage, resetsAt: resetTime(user.timeZone) } : null;
  return (
    <SettingsView
      // The OpenRouter callback's notice shows on the AI tab, so it lands there.
      tab={openrouter ? "ai" : tab}
      account={user ? { email: user.email, name: profile?.name ?? user.email, image: profile?.image ?? null, channelNames: user.channels.map((c) => c.name), rateLimit: user.rateLimit, apps, devices, security, aiKey, allowance, notice } : undefined}
    />
  );
}
