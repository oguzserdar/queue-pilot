"use client";


import { SignInButton } from "./sign-in-button";
import { UrlTabs } from "./url-tabs";

import { Avatar } from "@/registry/components/avatar/avatar";
import { AiApps } from "./ai-apps";
import { AiKeyCard, type ShownAiKey } from "./ai-key-card";
import { DeleteAccount } from "./delete-account";
import { SignedInDevices, type Device } from "./signed-in-devices";
import type { ApprovedApp } from "@/lib/ai-access";
import { Button } from "@/registry/components/button/button";
import { TabsContent, TabsList, TabsTrigger } from "@/registry/components/tabs/tabs";
import styles from "./settings-view.module.css";
import { quotaOf, windowOf } from "@/lib/rate-limit-text";

/** The example account's last RateLimit reading, in the format Buffer sends (developers.buffer.com/guides/api-limits). */
const EXAMPLE_RATE_LIMIT = [{ policy: "100-in-15min", remaining: 97 }, { policy: "250-in-24h", remaining: 212 }];

/** One line of the security activity list, already worded and dated on the server. */
export type ShownSecurityEvent = { what: string; where: string | null; when: string };

/** Everything the signed-in Settings screen shows, read on the server. */
export type SettingsAccount = {
  email: string;
  /** Browsers signed in to this account. */
  /** Null when the list could not be read. */
  devices: Device[] | null;
  /** AI apps allowed to use this account through the connector. */
  /** Null when the list could not be read. */
  apps: ApprovedApp[] | null;
  /** The person's own AI key in masked form; null when none is saved, undefined when it could not be read. */
  aiKey?: ShownAiKey;
  /** Today's use of Queue Pilot's built-in key; null when there is none or the person has their own key. */
  allowance?: { used: number; cap: number; budgetUsd: number; leftUsd: number; resetsAt: string } | null;
  /** Recent sign-ins and revoked AI apps, newest first; null when they could not be read. */
  security?: ShownSecurityEvent[] | null;
  /** A result to show on arrival, e.g. after connecting OpenRouter. */
  notice?: { ok: boolean; text: string } | null;
  /** Name and picture from the Buffer account, as in the account menu. */
  name: string;
  image: string | null;
  channelNames: string[];
  /** Buffer's RateLimit windows from the last sync, e.g. { policy: "250-in-24h", remaining: 212 }. */
  rateLimit?: { policy: string; remaining: number }[];
};

/** Settings: the example account when signed out, the person's own tabs when signed in. */
/**
 * The example account's Settings: the same screen a signed-in person sees, filled with example data. Its controls
 * answer "Sign in with Buffer first", and the three account buttons are swapped for sign-in.
 */
const EXAMPLE_ACCOUNT: SettingsAccount = {
  email: "mark@weeknightdinners.example",
  name: "Mark Evans",
  image: null,
  channelNames: ["LinkedIn", "Instagram", "Bluesky", "X"],
  rateLimit: EXAMPLE_RATE_LIMIT,
  apps: [{ consentId: "example-claude", name: "Claude", site: null, approvedAt: "2026-10-20T09:00:00.000Z", lastUsedAt: "2026-10-28T08:12:00.000Z", calls: 42 }],
  aiKey: null,
  allowance: { used: 3, cap: 10, budgetUsd: 100, leftUsd: 96.4, resetsAt: "00:00" },
  devices: [{ id: "example-device", device: "Chrome on Mac", lastActive: "2026-10-28T08:00:00.000Z", current: true }],
  security: [{ what: "Signed in", where: "Chrome on Mac", when: "2026-10-28T08:00:00.000Z" }],
  notice: null,
};

/** Settings: the person's own tabs when signed in, the same screen with the example account when not. */
export function SettingsView({ account, tab }: { account?: SettingsAccount; tab?: string }) {
  return account ? <LiveSettings account={account} tab={tab} /> : <LiveSettings account={EXAMPLE_ACCOUNT} tab={tab} example />;
}

/** The settings tabs; the open one lives in the address (?tab=ai) so a reload or a shared link opens it again. */
const TABS = ["account", "ai", "security"] as const;
type Tab = (typeof TABS)[number];

function LiveSettings({ account, tab, example = false }: { account: SettingsAccount; tab?: string; example?: boolean }) {
  const open: Tab = TABS.includes(tab as Tab) ? (tab as Tab) : "account";
  const n = account.channelNames.length;
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Settings</h1>
      </header>

      <UrlTabs initial={open} first="account">
        <TabsList aria-label="Settings sections">
          <TabsTrigger value="account">Account</TabsTrigger>
          <TabsTrigger value="ai">AI</TabsTrigger>
          <TabsTrigger value="security">Security</TabsTrigger>
        </TabsList>
        <TabsContent value="account">
          <div className={styles.tab}>
      <section className={styles.block} aria-labelledby="buffer">
        <h2 id="buffer" className={styles.h2}>Buffer</h2>
        <p className={styles.muted}>You sign in with Buffer, so your name, email and picture come from your Buffer account. Change them in Buffer, and Queue Pilot picks them up the next time you sign in.</p>
        <div className={styles.rows}>
          <div className={styles.row}>
            <div className={styles.profile}>
              <Avatar name={account.name} src={account.image ?? undefined} size="lg" />
              <div className={styles.name}>
                <strong>{account.name}</strong>
                <span className={styles.muted}>{account.email}</span>
                <span className={styles.muted}>{n === 0 ? "No channels yet" : `${n} channel${n === 1 ? "" : "s"}: ${account.channelNames.join(", ")}`}</span>
              </div>
            </div>
            {example ? <SignInButton /> : <form action="/auth/signout" method="post"><Button type="submit" variant="secondary" size="sm">Sign out</Button></form>}
          </div>
          {account.rateLimit && account.rateLimit.length > 0 ? (
            <div className={styles.row}>
              <div className={styles.name}>
                <strong>Buffer requests left</strong>
                <span className={styles.muted}>
                  {account.rateLimit.map((w) => `${w.remaining.toLocaleString("en-US")} of ${quotaOf(w.policy)} per ${windowOf(w.policy)}`).join(" · ")}. As of the last sync; Queue Pilot reuses its saved copy, so clicks cost none.
                </span>
              </div>
            </div>
          ) : null}
          <div className={styles.row}>
            <div className={styles.name}><strong>Only your Approve schedules</strong><span className={styles.muted}>Queue Pilot never schedules or publishes on its own. Your AI can only save drafts. Approve schedules only drafts Queue Pilot wrote.</span></div>
          </div>
        </div>
      </section>
      <section className={styles.block} aria-labelledby="export">
        <h2 id="export" className={styles.h2}>Download your data</h2>
        <p className={styles.muted}>One file with everything Queue Pilot keeps for you: your playbook, voice, sources, copies, the drafts it wrote, your AI apps and your security activity. Keys and sign-in tokens are never included.</p>
        {example ? <div><SignInButton>Sign in to download your data</SignInButton></div> : <a className={styles.download} href="/api/account/export" download>Download my data</a>}
      </section>
      <section className={styles.block} aria-labelledby="delete">
        <h2 id="delete" className={styles.h2}>Delete your account</h2>
        <p className={styles.muted}>Removes everything Queue Pilot keeps for you: your saved queue copy, sources, voice, Telegram and Discord copies, sign-ins and AI approvals. Your Buffer account, posts and drafts stay as they are. This cannot be undone.</p>
        {example ? <div><SignInButton>Sign in to manage your account</SignInButton></div> : <DeleteAccount />}
      </section>
          </div>
        </TabsContent>
        <TabsContent value="ai">
          <div className={styles.tab}>
      <section className={styles.block} aria-labelledby="ai-apps">
        <h2 id="ai-apps" className={styles.h2}>Who can use your Buffer</h2>
        <p className={styles.muted}>AI apps you allowed to read your queue and save drafts through Queue Pilot.</p>
        <AiApps apps={account.apps} />
      </section>
      <section className={styles.block} aria-labelledby="ai-key">
        <h2 id="ai-key" className={styles.h2}>Your AI key</h2>
        <p className={styles.muted}>For writing drafts here without connecting an AI app. Calls go from Queue Pilot to your provider with your key, and you pay your provider for them.</p>
        <AiKeyCard shown={account.aiKey} allowance={account.allowance ?? null} notice={account.notice ?? null} />
      </section>
          </div>
        </TabsContent>
        <TabsContent value="security">
          <div className={styles.tab}>
      <section className={styles.block} aria-labelledby="devices">
        <h2 id="devices" className={styles.h2}>Where you are signed in</h2>
        <SignedInDevices devices={account.devices} />
      </section>
      <section className={styles.block} aria-labelledby="security">
        <h2 id="security" className={styles.h2}>Security activity</h2>
        {account.security === null ? (
          <p className={styles.muted}>Security activity could not be read just now.</p>
        ) : !account.security?.length ? (
          <p className={styles.muted}>No sign-ins recorded yet.</p>
        ) : (
          <ul className={styles.events}>
            {account.security.map((e, i) => (
              <li key={i}>
                <strong>{e.what}</strong>
                {e.where && <span className={styles.muted}>{e.where}</span>}
                <time className={styles.muted}>{e.when}</time>
              </li>
            ))}
          </ul>
        )}
      </section>
          </div>
        </TabsContent>
      </UrlTabs>
    </div>
  );
}
