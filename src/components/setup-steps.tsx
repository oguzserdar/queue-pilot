"use client";

import type { ApprovedApp } from "@/lib/ai-access";

import { useState } from "react";
import { Button } from "@/registry/components/button/button";
import { ChipGroup } from "@/registry/components/chip-group/chip-group";
import { CopyButton } from "@/registry/components/copy-button/copy-button";
import { chatHandoff, setupLine } from "@/lib/agent-setup";
import { PLUGIN_SKILLS } from "@/lib/plugin-skills";
import styles from "./setup-steps.module.css";

/** The Buffer account the person signed in with, as Buffer returned it. */
export type SetupAccount = { email: string; channels: { name: string; service: string; disconnected: boolean }[] };

/** Apps that run in a terminal and can install skills with one command. */
const TERMINAL = ["Claude Code", "Codex", "Cursor"];
const APPS = ["Claude", "ChatGPT", "Grok", ...TERMINAL, "Other"];

const CONNECTION_CHECK = "Use Queue Pilot to read my setup status and list my drafts. Show the real draft count. Do not change, schedule or publish anything.";
const FIRST_TASK = "Then show me one preview post for my next empty time, written from my newest post. Show it here and do not save anything.";

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
};

/**
 * Finish setting up: four numbered steps at the top of Connect. Pick the AI app, which picks one main action (a setup
 * prompt for terminal apps, the app's own steps for chat apps); copy the skills command, shown only for terminal apps;
 * check the connection against what Queue Pilot really saw (the Buffer account read from Buffer, and when each AI app
 * last called); then copy a first task that saves nothing. `openApp` opens a chat app's setup steps on the page.
 */
export function SetupSteps({ origin, account, approved, example, openApp, initialApp = "Claude", guides = {} }: {
  origin: string;
  /** Each chat app's own connection steps, by the name picked here. */
  guides?: Record<string, string[]>;
  account: SetupAccount | null;
  approved: ApprovedApp[] | null;
  example: boolean;
  openApp: (name: string) => void;
  /** The app picked when the page opens. */
  initialApp?: string;
}) {
  const [app, setApp] = useState<string>(initialApp);
  const terminal = TERMINAL.includes(app);
  const reached = (approved ?? []).filter((a) => a.lastUsedAt).sort((a, b) => b.lastUsedAt!.localeCompare(a.lastUsedAt!));

  return (
    <section className={styles.setup} aria-labelledby="setup-title">
      <div className={styles.head}>
        <h2 id="setup-title" className={styles.title}>Finish setting up</h2>
        <p className={styles.muted}>No API key: your AI signs in with Buffer through Queue Pilot.</p>
      </div>
      <ol className={styles.steps}>
        <li className={styles.step}>
          <h3 className={styles.stepTitle}>Pick your AI, then paste one message into it</h3>
          <ChipGroup label="Your AI app" multiple={false} options={APPS.map((a) => ({ value: a, label: a }))}
            value={[app]} onValueChange={(v) => v[0] && setApp(v[0])} />
          <div className={styles.action}>
            <p className={styles.muted}>{terminal
              ? `Paste this into ${app}. It installs Queue Pilot's skills, connects itself, then writes one preview post. Nothing is saved.`
              : `Paste this into ${app}. ${app === "Other" ? "Your AI" : app} walks you through connecting Queue Pilot, then writes one preview post. Nothing is saved.`}</p>
            <CopyButton value={terminal ? `${setupLine(origin)}\n\n${FIRST_TASK}` : chatHandoff(app === "Other" ? "this app" : app, `${origin}/api/mcp`, guides[app] ?? guides["Any other MCP app"] ?? [], PLUGIN_SKILLS["queue-pilot-fill-week"] ?? "")} label={`Copy for ${app === "Other" ? "your AI" : app}`} />
            {!terminal && <Button variant="secondary" size="sm" onClick={() => openApp(app === "Other" ? "Any other MCP app" : app)}>Or follow the steps yourself</Button>}
          </div>
        </li>

        {terminal && (
          <li className={styles.step}>
            <h3 className={styles.stepTitle}>Or add the skills yourself</h3>
            <p className={styles.muted}>If you would rather run it in your terminal, this installs the same skills.</p>
            <div className={styles.command}>
              <code>npx skills add {origin}</code>
              <CopyButton value={`npx skills add ${origin}`} label="Copy" />
            </div>
          </li>
        )}

        <li className={styles.step}>
          <h3 className={styles.stepTitle}>Check it is connected</h3>
          {account ? (
            <p className={styles.fact}>
              <span className={styles.okMark} aria-hidden="true" />
              <span>Buffer: {account.email}, {account.channels.filter((c) => !c.disconnected).length} of {account.channels.length} channels connected ({account.channels.map((c) => c.name).join(", ")}).{" "}
              {!example && <a href="/sign-in">Not you? Sign in again</a>}</span>
            </p>
          ) : null}
          {reached.length ? (
            <p className={styles.fact}>
              <span className={styles.okMark} aria-hidden="true" />
              <span>{reached.map((a) => `${a.brand ?? a.name} reached Queue Pilot ${ago(a.lastUsedAt!)}`).join(". ")}.</span>
            </p>
          ) : (
            <div className={styles.action}>
              <p className={styles.muted}>No AI app has reached Queue Pilot yet. Send this check from your AI. It changes nothing.</p>
              <CopyButton value={CONNECTION_CHECK} label="Copy connection check" />
            </div>
          )}
        </li>

      </ol>
    </section>
  );
}
