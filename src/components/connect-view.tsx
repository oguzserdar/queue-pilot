"use client";

import type { ApprovedApp } from "@/lib/ai-access";

import { useState } from "react";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { Button } from "@/registry/components/button/button";
import { AiMark } from "./ai-mark";
import { CopyButton } from "@/registry/components/copy-button/copy-button";
import { setupLine } from "@/lib/agent-setup";
import { sinceText } from "@/lib/connect-links";
import styles from "./connect-view.module.css";

/** One chat app's setup, shown in its modal. Coding agents set themselves up from the copied prompt instead. */
type AiSetup = {
  name: string;
  plan: string;
  does: string;
  steps: string[];
  /** A picture of where Queue Pilot is added in the app, shown in its setup modal. */
  image?: string;
};

/** Coding agents that set themselves up from the copied setup prompt. */
const CODING_AGENTS = ["Claude Code", "Codex", "Cursor"];

// Every step uses the AI app's own words and menu names, as its documentation gives them.
const AIS: AiSetup[] = [
  {
    name: "ChatGPT",
    plan: "Needs ChatGPT Plus, Pro, Business or Enterprise, on the web",
    does: "See next week and fill the empty slots with drafts, inside a chat.",
    steps: [
      "Go to chatgpt.com/plugins, press +, then Add custom MCP server. Name it Queue Pilot",
      "Under Connection, paste the URL above as the Server URL. Keep OAuth",
      "Select I understand and want to continue, then Create as a plugin",
      "Install it, then type @ in a chat and pick Queue Pilot",
      "No Add custom MCP server? Turn on Developer mode in Settings, Security",
    ],
  },
  {
    name: "Claude",
    plan: "Works on every Claude plan. Free allows one custom connector",
    does: "Pick \"Fill my week\" and Claude drafts your empty times from your newsletter.",
    steps: [
      "Go to Customize, Connectors, press + Add, then Add custom connector. Name it Queue Pilot",
      "Paste the URL above and press Continue. Keep Sign in now, then press Add",
      "On Team or Enterprise, an Owner adds it first, then you press Connect",
    ],
  },
  {
    name: "Grok",
    plan: "Works on every Grok plan. On Business or Enterprise, your admin adds it first",
    does: "Ask for drafts from your latest issue and save them to Buffer.",
    steps: ["Go to grok.com/connectors, press New Connector, then Custom", "Paste the URL above as the MCP server URL", "Sign in with Buffer when Grok asks"],
  },
  {
    name: "Any other MCP app",
    plan: "Any app that supports remote MCP servers with sign-in",
    does: "Use Queue Pilot from any AI app that can add a remote MCP server.",
    steps: ["Add a remote server (Streamable HTTP) with the URL above", "Sign in with Buffer when the app asks"],
  },
];

/**
 * Connect: how to add Queue Pilot to each AI the person already pays for. The address is this deployment's connector.
 * `approved` lists the AI apps the person approved, with when each last called the connector, so "connected" here
 * always means the app really reached Queue Pilot.
 */
export function ConnectView({ connectorUrl, example = false, approved = null, now = Date.now() }: { connectorUrl: string; example?: boolean; approved?: ApprovedApp[] | null; now?: number }) {
  // Which app's setup is open in the modal; the page itself only lists the apps.
  const [open, setOpen] = useState<string | null>(null);
  const current = AIS.find((x) => x.name === open);

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Connect your AI</h1>
        <p className={styles.sub}>Your AI does the writing. Queue Pilot gives it your Buffer slots, your schedule and your material, and checks what it writes before it goes out.</p>
        {!example && !approved?.length && <p className={styles.sub} role="status">No AI app is connected yet.</p>}
        {!example && !!approved?.length && (
          <ul className={styles.used} aria-label="Your connected AI apps">
            {approved.map((a) => (
              <li key={a.consentId}>
                <strong>{a.name}</strong>
                <span className={a.lastUsedAt ? styles.ok : styles.muted}>
                  {a.lastUsedAt ? <><span className={styles.okMark} aria-hidden="true" />Last used {sinceText(a.lastUsedAt, now)}</> : "Approved, not used yet"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </header>

      <section className={styles.onboard} aria-labelledby="onboard-title">
        <div>
          <h2 id="onboard-title" className={styles.onboardTitle}>Onboard your coding agent</h2>
          <p className={styles.muted}>Copy one line into Claude Code, Codex or Cursor. It installs the Queue Pilot skill and connects itself.</p>
        </div>
        <span className={styles.onboardMarks} aria-hidden="true">{CODING_AGENTS.map((n) => <AiMark key={n} name={n} size={18} />)}</span>
        <CopyButton value={setupLine(connectorUrl.replace(/\/api\/mcp$/, ""))} label="Copy setup prompt" />
        <a href={`${connectorUrl.replace(/\/api\/mcp$/, "")}/.well-known/agent-skills/queue-pilot/SKILL.md`} target="_blank" rel="noreferrer">Read the Queue Pilot skill</a>
      </section>

      <h2 className={styles.chatTitle}>Or add it in a chat app</h2>
      <div className={styles.address}>
        <span className={styles.label}>Connector URL</span>
        <code className={styles.code}>{connectorUrl}</code>
        <CopyButton value={connectorUrl} label="Copy" />
      </div>

      <ul className={styles.tiles}>
        {AIS.map((a) => (
          <li key={a.name} className={styles.tile}>
            <div className={styles.cardHead}>
              <strong className={styles.name}><AiMark name={a.name} size={20} />{a.name}</strong>
              {example && a.name === "Claude" ? <span className={styles.ok}><span className={styles.okMark} aria-hidden="true" />Connected</span> : null}
            </div>
            <p className={styles.does}>{a.does}</p>
            <Button variant="secondary" size="sm" onClick={() => setOpen(a.name)} aria-label={`Set up ${a.name}`}>Set up</Button>
          </li>
        ))}
      </ul>

      <Dialog open={current !== undefined} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        {current && (
          <DialogContent title={`Connect ${current.name}`} description={current.does} className={styles.dialog}>
            <div className={styles.dialogBody}>
            {current.image && <img className={styles.shot} src={current.image} alt={`Where Queue Pilot is added in ${current.name}`} width={1200} height={750} />}
            <div className={styles.address}>
              <span className={styles.label}>Connector URL</span>
              <code className={styles.code}>{connectorUrl}</code>
              <CopyButton value={connectorUrl} label="Copy" />
            </div>
            <ol className={styles.steps}>{current.steps.map((st) => <li key={st}>{st}</li>)}</ol>
            <p className={styles.muted}>{current.plan}</p>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
