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
import { claimAdmin, clearAdminSetting, saveAdminSetting } from "./actions";
import { hasAdmin } from "@/lib/admin-role";
import { postgresAllowanceStore, utcDay } from "@/lib/ai-allowance";
import { AiUsage } from "@/components/ai-usage";
import { UrlTabs } from "@/components/url-tabs";
import styles from "./admin.module.css";

export const dynamic = "force-dynamic";

const NOTES: Record<string, string> = {
  db: "Connect a database to this deployment before saving keys.",
  empty: "A key cannot be empty. Use Remove to clear it.",
  pinned: "The server's environment sets that one, so it cannot be changed here.",
  key: "Unknown setting.",
};

export default async function Admin({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string; cleared?: string; field?: string; problem?: string; tab?: string }> }) {
  const { error, saved, cleared, field, problem, tab } = await searchParams;
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
          <SetupSteps email={access === "signed-out" ? null : await signedInEmail()} codeWrong={problem === "code"} />
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
      ? Promise.all([allowanceStore.spentMicros(), allowanceStore.used("admin-view", utcDay(new Date()))])
          .then(([spent, today]) => ({ spentUsd: spent / 1_000_000, today: today.total }))
          .catch(() => null)
      : null,
  ]);
  const num = (k: SettingKey) => { const v = rows.find((r) => r.key === k)?.layers.find((l) => l.inUse)?.display; const n = v ? Number.parseFloat(v) : NaN; return Number.isFinite(n) ? n : null; };
  const budgetUsd = num("ai_budget_usd");
  const perPerson = num("ai_cap_per_person") ?? 10;
  const totalCap = num("ai_cap_total");
  const groups = Object.keys(GROUPS) as GroupId[];
  // After a save or remove, reopen the tab that holds the field that changed.
  const changed = (saved ?? cleared ?? field) as SettingKey | undefined;
  // The tab of a setting just changed, else the one in the address, else the first.
  const openTab = changed && SETTINGS[changed] ? SETTINGS[changed].group : tab && [...groups, "activity"].includes(tab) ? tab : groups[0];
  return (
    <main className={styles.page}>
      <header className={styles.head}>
        <div>
          <p className={styles.mark}>Queue Pilot<span>.</span></p>
          <h1 className={styles.title}>Settings</h1>
          <p className={styles.sub}>Keys and limits for this deployment{email ? `. Signed in as ${email}, admin` : ""}.</p>
        </div>
        <a className={styles.back} href="/">Back to Queue Pilot</a>
      </header>
      {!hasDatabase() ? <p className={styles.error} role="alert">{NOTES.db}</p> : null}
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
                  <AiUsage view="operator" today={usage.today} totalCap={totalCap} perPerson={perPerson} budgetUsd={budgetUsd} leftUsd={Math.max(0, budgetUsd - usage.spentUsd)} resetsAt="00:00 UTC" />
                </section>
              ) : null}
              {rows.filter((r) => r.group === g).map((r) => (
                <section key={r.key} className={styles.card} aria-labelledby={`s-${r.key}`}>
                  <div className={styles.cardHead}>
                    <h2 id={`s-${r.key}`} className={styles.cardTitle}>{r.label}</h2>
                    <Badge size="sm" tone={r.source === "saved" ? "success" : r.display ? "neutral" : "warning"}>
                      {r.source === "environment" ? "Set on the server" : r.source === "saved" ? "Saved here" : r.display ? "Default" : "Not set"}
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
                        <span className={styles.layerState}>{l.inUse ? "In use" : l.display && r.layers.some((x) => x.inUse) ? "Ignored" : ""}</span>
                      </li>
                    ))}
                  </ol>
                  {saved === r.key ? <p className={styles.ok} role="status">Saved.</p> : null}
                  {cleared === r.key ? <p className={styles.ok} role="status">Removed. {r.source === "environment" ? "The server's value applies again." : ""}</p> : null}
                  {field === r.key && (problem || error) ? <p className={styles.error} role="alert">{problem ?? NOTES[error ?? ""]}</p> : null}
                  {r.pinned ? (
                    <p className={styles.help}>Set in the server&apos;s environment as <code className={styles.code}>{r.env}</code>. Change it there; this page shows it read-only.</p>
                  ) : (
                    <div className={styles.cardFoot}>
                      <form action={saveAdminSetting} className={styles.field}>
                        <input type="hidden" name="key" value={r.key} />
                        {r.type === "secret" || r.type === "ai-key"
                          ? <PasswordField name="value" label={r.display ? "Replace with" : "Value"} autoComplete="off" placeholder={PLACEHOLDER[r.type]} />
                          : <Input name="value" label={r.display ? "Replace with" : "Value"} inputMode={r.type === "usd" ? "decimal" : "numeric"} autoComplete="off" placeholder={PLACEHOLDER[r.type]} />}
                        <Button type="submit" variant="primary" size="md">Save</Button>
                      </form>
                      {r.source === "saved" ? (
                        <form action={clearAdminSetting}>
                          <input type="hidden" name="key" value={r.key} />
                          <Button type="submit" variant="ghost" size="sm">Remove</Button>
                        </form>
                      ) : null}
                    </div>
                  )}
                </section>
              ))}
            </div>
          </TabsContent>
        ))}
        <TabsContent value="activity">
          <div className={styles.section}>
            <p className={styles.sub}>Every change made on this page, newest first. Secrets are never shown.</p>
            {changes.length ? (
              <ul className={styles.card}>
                {changes.map((c) => (
                  <li key={c.id} className={styles.change}>
                    <time className={styles.help} dateTime={c.at.toISOString()}>{c.at.toISOString().slice(0, 16).replace("T", " ")} UTC</time>
                    <span>{SETTINGS[c.key as SettingKey]?.label ?? c.key} {c.action === "cleared" ? "removed" : c.fromValue !== null || c.toValue !== null ? `${c.fromValue ?? "not set"} → ${c.toValue}` : "changed"}</span>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No changes yet" description="When you save or remove a value here, it is listed with the time." />}
          </div>
        </TabsContent>
      </UrlTabs>
    </main>
  );
}

/** An example in each empty field, so the expected shape is clear before typing. */
const PLACEHOLDER: Record<string, string> = { secret: "Paste the key", "ai-key": "sk-ant-…, sk-… or sk-or-…", usd: "e.g. 50", int: "e.g. 10" };

/** First-run setup, two numbered steps: sign in with Buffer, then claim the deployment. A done step shows its tick. */
function SetupSteps({ email, codeWrong = false }: { email: string | null; codeWrong?: boolean }) {
  const needsCode = Boolean(process.env.ADMIN_SETUP_CODE?.trim());
  return (
    <section className={styles.setup} aria-labelledby="setup-title">
      <p className={styles.mark}>Queue Pilot<span>.</span></p>
      <h1 id="setup-title" className={styles.title}>Set up Queue Pilot</h1>
      <p className={styles.sub}>Two steps, once. The person who finishes them runs this deployment and manages its keys.</p>
      <ol className={styles.steps}>
        <li className={styles.step} data-done={email ? "true" : undefined}>
          <span className={styles.num} aria-hidden="true">{email ? "✓" : "1"}</span>
          <div className={styles.stepBody}>
            <strong>Sign in with Buffer</strong>
            {email ? <span className={styles.muted}>Signed in as {email}</span> : <SignInButton variant="primary" size="md" returnTo="/admin" />}
          </div>
        </li>
        <li className={styles.step} data-current={email ? "true" : undefined}>
          <span className={styles.num} aria-hidden="true">2</span>
          <div className={styles.stepBody}>
            <strong>Become the admin</strong>
            <span className={styles.muted}>Only one person can claim a new deployment. More admins are added later from the server.</span>
            {email ? (
              <form action={claimAdmin} className={styles.field}>
                {needsCode ? <PasswordField name="code" label="Setup code" description="The ADMIN_SETUP_CODE value from this deployment's settings." autoComplete="off" required /> : null}
                <Button type="submit" variant="primary" size="md">Become the admin</Button>
              </form>
            ) : null}
            {codeWrong ? <p className={styles.error} role="alert">That setup code does not match this deployment's.</p> : null}
          </div>
        </li>
      </ol>
    </section>
  );
}
