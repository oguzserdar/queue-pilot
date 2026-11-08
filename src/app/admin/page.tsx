import { TestSourceKey } from "@/components/test-source-key";
import { SignInButton } from "@/components/sign-in-button";
import { Badge } from "@/registry/components/badge/badge";
import { Button } from "@/registry/components/button/button";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { Input } from "@/registry/components/input/input";
import { PasswordField } from "@/registry/components/password-field/password-field";
import { TabsContent, TabsList, TabsTrigger } from "@/registry/components/tabs/tabs";
import { adminAccess, signedInEmail } from "@/lib/current-user";
import { hasDatabase, postgresSettingsStore, recentSettingChanges } from "@/lib/db";
import { describeSettings, GROUPS, memoryStore, SETTINGS, type GroupId, type SettingKey } from "@/lib/settings";
import { SettingButton, SettingSaveForm } from "./setting-forms";
import { ToastStack, ToastStackProvider } from "@/registry/components/toast-stack/toast-stack";
import { AdminRecovery, SetupSteps } from "./setup-steps";
import { setupCodeReady, setupCodeRequired } from "@/lib/admin-setup-code";
import { HeldBackNotice, LegacyChoice, ShadowedNotice } from "./shadowed-notice";
import { hasAdmin } from "@/lib/admin-role";
import { postgresAllowanceStore, utcDay } from "@/lib/ai-allowance";
import { AiUsage } from "@/components/ai-usage";
import { UrlTabs } from "@/components/url-tabs";
import styles from "./admin.module.css";

export const dynamic = "force-dynamic";

const NO_DATABASE = "Connect a database to this deployment before saving keys.";

export default async function Admin({ searchParams }: { searchParams: Promise<{ problem?: string; tab?: string }> }) {
  const { problem, tab } = await searchParams;
  const master = process.env.SETTINGS_KEY;

  if (!master) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>Admin is not set up on this deployment</h1>
        <p className={styles.sub}>The deployment needs its settings key (SETTINGS_KEY) before this page opens.</p>
      </main>
    );
  }

  const access = await adminAccess();
  if (access !== "admin") {
    // A fresh deployment has no admin yet: whoever sets it up claims it here, once.
    // If the check fails, treat the deployment as claimed: an error must never offer the claim button.
    const unclaimed = hasDatabase() && !(await hasAdmin().catch((e) => {
      console.error(JSON.stringify({ event: "qp-admin-check-failed", message: e instanceof Error ? e.message : String(e) }));
      return true;
    }));
    return (
      <main className={styles.page}>
        {unclaimed ? (
          <SetupSteps email={access === "signed-out" ? null : await signedInEmail()} needsCode={setupCodeRequired()} ready={setupCodeReady()} problem={problem} />
        ) : access === "signed-out" ? (
          <>
            <h1 className={styles.title}>Queue Pilot admin</h1>
            <p className={styles.sub}>Sign in with Buffer to manage the keys this deployment uses.</p>
            <SignInButton variant="primary" size="md" returnTo="/admin" />
          </>
        ) : (
          <>
          <h1 className={styles.title}>Queue Pilot admin</h1>
          <p className={styles.sub}>Only this deployment&apos;s admin can change its keys. You are signed in, but you are not the admin.</p>
          <AdminRecovery />
          </>
        )}
      </main>
    );
  }

  // Independent reads, so they run together. Usage comes from the same store that enforces the limits, so /admin
  // and Settings agree.
  const allowanceStore = postgresAllowanceStore();
  const [rows, changes, email, usage] = await Promise.all([
    describeSettings(hasDatabase() ? postgresSettingsStore() : memoryStore(), master),
    hasDatabase() ? recentSettingChanges().catch(() => []) : [],
    signedInEmail(),
    hasDatabase()
      ? Promise.all([allowanceStore.spentMicros(), allowanceStore.spentOn(utcDay(new Date())), allowanceStore.used("admin-view", utcDay(new Date()))])
          .then(([spent, spentToday, today]) => ({ spentUsd: spent / 1_000_000, spentTodayUsd: spentToday / 1_000_000, today: today.total }))
          .catch(() => null)
      : null,
  ]);
  const num = (k: SettingKey) => { const v = rows.find((r) => r.key === k)?.layers.find((l) => l.inUse)?.display; const n = v ? Number.parseFloat(v) : NaN; return Number.isFinite(n) ? n : null; };
  const budgetUsd = num("ai_budget_usd");
  const perPerson = num("ai_cap_per_person") ?? 10;
  const totalCap = num("ai_cap_total");
  const groups = Object.keys(GROUPS) as GroupId[];
  // The tab in the address, else the first. Saving no longer reloads the page, so the open tab stays open.
  const openTab = tab && [...groups, "activity"].includes(tab) ? tab : groups[0];
  return (
    <ToastStackProvider>
    <main className={styles.page}>
      <header className={styles.head}>
        <div>
          <p className={styles.mark}>Queue Pilot<span>.</span></p>
          <h1 className={styles.title}>Settings</h1>
          <p className={styles.sub}>Keys and limits for this deployment{email ? `. Signed in as ${email}, admin` : ""}.</p>
        </div>
        <a className={styles.back} href="/">Back to Queue Pilot</a>
      </header>
      {!hasDatabase() ? <p className={styles.error} role="alert">{NO_DATABASE}</p> : null}
      <HeldBackNotice keys={rows.filter((r) => r.heldBack).map((r) => r.key)} />
      <ShadowedNotice keys={rows.filter((r) => r.shadowsEnv).map((r) => r.key)} />
      <UrlTabs initial={openTab} first={groups[0]}>
        <TabsList aria-label="Settings sections">
          {groups.map((g) => <TabsTrigger key={g} value={g}>{GROUPS[g].title}</TabsTrigger>)}
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>
        {groups.map((g) => (
          <TabsContent key={g} value={g}>
            <div className={styles.section}>
              <p className={styles.sub}>{GROUPS[g].help}</p>
              {g === "ai" && usage && budgetUsd ? (
                <section className={styles.card} aria-label="Built-in AI usage">
                  <AiUsage view="operator" today={usage.today} totalCap={totalCap} perPerson={perPerson} budgetUsd={budgetUsd} leftUsd={Math.max(0, budgetUsd - usage.spentUsd)} spentUsd={usage.spentUsd} spentTodayUsd={usage.spentTodayUsd} resetsAt="00:00 UTC" />
                </section>
              ) : null}
              {rows.filter((r) => r.group === g).map((r) => (
                <section key={r.key} className={styles.card} aria-labelledby={`s-${r.key}`}>
                  <div className={styles.cardHead}>
                    <h2 id={`s-${r.key}`} className={styles.cardTitle}>{r.label}</h2>
                    <Badge size="sm" tone={r.source === "saved" ? "success" : r.display ? "neutral" : "warning"}>
                      {r.source === "environment" ? "From the server environment" : r.source === "saved" ? "Saved here" : r.display ? "Default" : "Not set"}
                    </Badge>
                  </div>
                  <p className={styles.help}>{r.help}</p>
                  {/* Every source in the order it is tried; the one in use is marked, a value lower down shows as ignored. */}
                  <ol className={styles.layers} aria-label="Where the value comes from, first match wins">
                    {r.layers.map((l, i) => (
                      <li key={l.source} className={styles.layer} data-in-use={l.inUse || undefined}>
                        <span className={styles.layerNum}>{i + 1}</span>
                        <span className={styles.layerName}>{l.source === "environment" ? <>Server env <code className={styles.code}>{r.env}</code></> : l.source === "saved" ? "Saved here" : "Default"}</span>
                        <span className={styles.layerValue}>{l.display ? <code className={styles.code}>{l.display}</code> : <span className={styles.none}>none</span>}</span>
                        <span className={styles.layerState}>{l.inUse ? "In use" : l.source === "saved" && r.heldBack ? "Waiting for you" : l.display && r.layers.some((x) => x.inUse) ? "Ignored" : ""}</span>
                      </li>
                    ))}
                  </ol>
                  {(r.key === "supadata_api_key" || r.key === "exa_api_key") && <TestSourceKey setting={r.key} />}
                  {r.heldBack ? (
                    <div className={styles.help}>
                      <p>The value saved here is from before this version, when the server&apos;s environment won. So nothing changed on upgrade, the server&apos;s value <code className={styles.code}>{r.env}</code> is still in use. Use the saved value to make it win, save a new one, or remove it.</p>
                      <LegacyChoice settingKey={r.key} />
                    </div>
                  ) : r.legacy ? (
                    <p className={styles.help}>Saved here before this version. It is in use because the server&apos;s environment sets no <code className={styles.code}>{r.env}</code>. If the server sets one later, the server&apos;s value is used until you save this again.</p>
                  ) : r.source === "environment" ? (
                    <p className={styles.help}>Set in the server&apos;s environment as <code className={styles.code}>{r.env}</code>. A value saved here replaces it, and removing that value goes back to the server&apos;s.</p>
                  ) : null}
                  <div className={styles.cardFoot}>
                    <SettingSaveForm settingKey={r.key}>
                      {r.type === "secret" || r.type === "ai-key"
                        ? <PasswordField name="value" label={r.display ? "Replace with" : "Value"} autoComplete="off" placeholder={PLACEHOLDER[r.type]} />
                        : <Input name="value" label={r.display ? "Replace with" : "Value"} inputMode={r.type === "usd" ? "decimal" : r.type === "int" ? "numeric" : undefined} autoComplete="off" placeholder={PLACEHOLDER[r.type]} />}
                    </SettingSaveForm>
                    {r.source === "saved" ? (
                      <SettingButton settingKey={r.key} kind="clear" label={r.layers.some((l) => l.source === "environment" && l.display) ? "Use the server's value" : "Remove"} />
                    ) : null}
                  </div>
                </section>
              ))}
            </div>
          </TabsContent>
        ))}
        <TabsContent value="activity">
          <div className={styles.section}>
            <p className={styles.sub}>Every change made on this page, newest first, with who made it. Secrets are never shown.</p>
            {changes.length ? (
              <ul className={styles.card}>
                {changes.map((c) => (
                  <li key={c.id} className={styles.change}>
                    <time className={styles.help} dateTime={c.at.toISOString()}>{c.at.toISOString().slice(0, 16).replace("T", " ")} UTC</time>
                    <span className={styles.help}>{c.actorId === null ? "By an unknown admin (recorded before names were kept)" : c.actorEmail ? `By ${c.actorEmail}` : "By an admin whose account was deleted"}</span>
                    <span>{SETTINGS[c.key as SettingKey]?.label ?? c.key} {c.action === "cleared" ? "removed" : c.action === "kept" ? "saved value chosen over the server's" : c.fromValue !== null || c.toValue !== null ? `${c.fromValue ?? "not set"} → ${c.toValue}` : "changed"}</span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No changes yet" description="When you save or remove a value here, it is listed with the time." />}
          </div>
        </TabsContent>
      </UrlTabs>
    </main>
    <ToastStack />
    </ToastStackProvider>
  );
}

/** An example in each empty field, so the expected shape is clear before typing. */
const PLACEHOLDER: Record<string, string> = { secret: "Paste the key", "ai-key": "sk-ant-…, sk-… or sk-or-…", usd: "e.g. 50", int: "e.g. 10" };
