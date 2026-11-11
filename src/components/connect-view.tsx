"use client";

import type { ApprovedApp } from "@/lib/ai-access";

import { useState } from "react";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { Button } from "@/registry/components/button/button";
import { AiMark } from "./ai-mark";
import { CopyButton } from "@/registry/components/copy-button/copy-button";
import { aiBrand } from "@/lib/ai-brand";
import { APP_ONLY, CONNECTOR_CATALOG } from "@/lib/connector-catalog";
import { SetupSteps, type SetupAccount } from "./setup-steps";
import { Term } from "./term";
import styles from "./connect-view.module.css";

/** One chat app's setup, shown in its modal. Coding agents set themselves up from the copied prompt instead. */
type AiSetup = {
  name: string;
  mark?: string;
  plan: string;
  does: string;
  steps: string[];
  setupPrompt?: (url: string) => string;
  help?: string;
  docs?: string;
  /** A picture of where Queue Pilot is added in the app, shown in its setup modal. */
  image?: string;
};

/** Coding agents that set themselves up from the copied setup prompt. */
const CONNECTION_CHECK = "Use Queue Pilot to read my setup status and list my drafts. Show the real draft count. Do not change, schedule or publish anything.";

// Grok web and Grok Bot have separate setup paths. Claude remote connectors belong to the Claude account.
const AIS: AiSetup[] = [
  {
    name: "ChatGPT",
    plan: "Set this up on ChatGPT web. Workspace permissions may restrict custom plugins.",
    does: "See next week and fill the empty times with drafts, inside a chat.",
    steps: [
      "Go to chatgpt.com/plugins, press +, then Add custom MCP server. Name it Queue Pilot",
      "Under Connection, paste the URL above as the Server URL. Keep OAuth",
      "Select I understand and want to continue, then Create as a plugin",
      "Install the plugin and complete the Queue Pilot sign-in. Check the account on the permission page, then Allow",
      "Start a new chat, type @ and pick Queue Pilot. Send the connection check below",
    ],
    help: "Missing new tools? Open Queue Pilot's details in ChatGPT's app settings and refresh its tools, then start a new chat. If the add option is unavailable, check your workspace permissions.",
    docs: "https://developers.openai.com/api/docs/guides/custom-mcp-server",
  },
  {
    name: "Claude",
    plan: "Available on every Claude plan. Free allows one custom connector. Remote connectors belong to your Claude account and work across web, desktop and mobile.",
    does: "Pick \"Fill my week\" and Claude drafts your empty times from your own work, in your email, docs or blog.",
    steps: [
      "Go to Customize, Connectors, press + Add, then Add custom connector. Name it Queue Pilot",
      "Paste the URL above and press Continue. Review the detected authentication, then Continue again",
      "Choose Sign in now and Use Claude's published identity. Press Add, then finish the Queue Pilot sign-in and Allow",
      "In a chat, open +, then Connectors, and enable Queue Pilot. Send the connection check below",
    ],
    help: "On Team or Enterprise, an authorized owner or admin adds the connector in Organization settings first. Each member then connects with their own account.",
    docs: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
  },
  {
    name: "Grok web",
    mark: "Grok",
    plan: "These steps are for grok.com. Grok Bot desktop needs its own connection.",
    does: "Use Queue Pilot in a chat on grok.com.",
    steps: ["Go to grok.com/connectors, press New Connector, then Custom", "Name it Queue Pilot, paste the URL above into Server URL, then press Add Connector", "On Queue Pilot's connection page, check the account and press Allow. Sign in with Buffer first if asked", "In a new Grok chat, send the connection check below"],
    help: "These are the browser steps. For the Grok Bot app, use the separate desktop guide. Business and Enterprise accounts may need an admin to add the connector first.",
    docs: "https://docs.x.ai/grok/connectors",
  },
  {
    name: "Grok Bot desktop",
    mark: "Grok",
    plan: "Set up Grok Bot separately from grok.com. In the desktop build we tested, the permission page says Cursor, the name Grok Bot registers for its connection.",
    does: "Ask your bot to add Queue Pilot, then finish sign-in in your browser.",
    setupPrompt: (url) => `Connect Queue Pilot using ${url} as a remote MCP server with OAuth. After I sign in, call get_setup_status and list_my_drafts to confirm the connection. Read only; do not change, schedule or publish anything.`,
    steps: ["Copy the setup request below and send it to your bot in Grok Bot desktop", "Use the Queue Pilot connection card to start sign-in, then finish on Queue Pilot's page in your browser", "Check Connect apps, Your plugins, queue-pilot for its connection status. Use Reconnect there if sign-in was interrupted", "Ask your bot to read your Queue Pilot setup status and drafts. A successful read confirms it is connected"],
    help: "Added only means installed. If it still says Not connected or shows zero tools, finish sign-in using Reconnect or the card's Reopen button. There is no need to change your default browser.",
    docs: "https://docs.x.ai/grok-bot/computer-and-apps",
  },
  {
    name: "Any other MCP app",
    plan: "Any app that supports remote MCP servers with sign-in",
    does: "Use Queue Pilot from any AI app that can add a remote MCP server.",
    steps: ["Add a remote server (Streamable HTTP) with the URL above", "Sign in with Buffer when the app asks, then review Queue Pilot's permission page", "Send the connection check below. Seeing the server listed does not confirm it can read your account"],
  },
];

/** Each chat app's own connection steps, by the name the app picker uses ("Grok" for Grok web). */
export const CHAT_GUIDES: Record<string, string[]> = Object.fromEntries(AIS.map((a) => [a.name === "Grok web" ? "Grok" : a.name, a.steps]));
/** The chat apps whose setup steps can be opened from another page with `/connect?setup=<name>`. */
const OPENABLE = new Set(Object.keys(CHAT_GUIDES).filter((n) => n !== "Grok Bot desktop"));

/**
 * Connect: how to add Queue Pilot to each AI the person already pays for. The address is this deployment's connector.
 * `approved` lists the AI apps the person approved, with when each last called the connector, so "connected" here
 * always means the app really reached Queue Pilot.
 */
export function ConnectView({ connectorUrl, example = false, approved = null, account = null, setup }: { connectorUrl: string; example?: boolean; approved?: ApprovedApp[] | null; account?: SetupAccount | null; /** A chat app whose steps open on arrival, from `?setup=`. */ setup?: string }) {
  // Which app's setup is open in the modal; the page itself only lists the apps.
  const [open, setOpen] = useState<string | null>(setup && OPENABLE.has(setup) ? setup : null);
  const [grokSurface, setGrokSurface] = useState("Grok web");
  const connected = !example && !!approved?.length;
  const current = AIS.find((x) => x.name === (open === "Grok" ? grokSurface : open));

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Connect your AI</h1>
        <p className={styles.sub}>Your AI does the writing. Queue Pilot gives it your empty Buffer times and your material, and checks what it writes before you approve.</p>
        {/* Connections are managed in one place, Settings; here a single line confirms what is connected. */}
        {!example && !!approved?.length && (
          <p className={styles.connectedLine}>
            <span className={styles.connectedMarks} aria-hidden="true">{[...new Set(approved.map((a) => a.brand).filter((b): b is string => !!b))].map((b) => <AiMark key={b} name={b} size={16} />)}</span>
            <span>Connected: {[...new Set(approved.map((a) => a.brand ?? a.name))].join(", ")}</span>
            <a href="/settings?tab=ai">Manage</a>
          </p>
        )}
      </header>

      {/* Once an AI has really reached Queue Pilot, setup folds away: the page leads with what it can do. */}
      {connected ? (
        <details className={styles.another}>
          <summary className={styles.anotherSummary}>Add another AI</summary>
      <SetupSteps origin={connectorUrl.replace(/\/api\/mcp$/, "")} account={account} approved={approved} example={example} guides={CHAT_GUIDES}
        openApp={(name) => { setGrokSurface("Grok web"); setOpen(name === "Grok" ? "Grok" : name); }} />

      <h2 className={styles.chatTitle}>Or add it in a chat app</h2>
      <div className={styles.address}>
        <span className={styles.label}><Term term="Connector URL, or MCP server URL" note="Claude calls it a custom connector URL, ChatGPT a server URL. They all mean this address.">Queue Pilot's address</Term></span>
        <code className={styles.code}>{connectorUrl}</code>
        <CopyButton value={connectorUrl} label="Copy" />
      </div>

      <ul className={styles.tiles}>
        {AIS.filter((a) => a.name !== "Grok Bot desktop").map((a) => (
          <li key={a.name} className={styles.tile}>
            <div className={styles.cardHead}>
              <strong className={styles.name}><AiMark name={a.mark ?? a.name} size={20} />{a.name === "Grok web" ? "Grok" : a.name}</strong>
              {example && a.name === "Claude" ? <span className={styles.ok}><span className={styles.okMark} aria-hidden="true" />Connected</span> : null}
            </div>
            <p className={styles.does}>{a.name === "Grok web" ? "Connect on grok.com or in Grok Bot desktop." : a.does}</p>
            <Button variant="secondary" size="sm" onClick={() => { setGrokSurface("Grok web"); setOpen(a.name === "Grok web" ? "Grok" : a.name); }} aria-label={`Set up ${a.name === "Grok web" ? "Grok" : a.name}`}>Set up</Button>
          </li>
        ))}
      </ul>
        </details>
      ) : <>
      <SetupSteps origin={connectorUrl.replace(/\/api\/mcp$/, "")} account={account} approved={approved} example={example} guides={CHAT_GUIDES}
        openApp={(name) => { setGrokSurface("Grok web"); setOpen(name === "Grok" ? "Grok" : name); }} />

      <h2 className={styles.chatTitle}>Or add it in a chat app</h2>
      <div className={styles.address}>
        <span className={styles.label}><Term term="Connector URL, or MCP server URL" note="Claude calls it a custom connector URL, ChatGPT a server URL. They all mean this address.">Queue Pilot's address</Term></span>
        <code className={styles.code}>{connectorUrl}</code>
        <CopyButton value={connectorUrl} label="Copy" />
      </div>

      <ul className={styles.tiles}>
        {AIS.filter((a) => a.name !== "Grok Bot desktop").map((a) => (
          <li key={a.name} className={styles.tile}>
            <div className={styles.cardHead}>
              <strong className={styles.name}><AiMark name={a.mark ?? a.name} size={20} />{a.name === "Grok web" ? "Grok" : a.name}</strong>
              {example && a.name === "Claude" ? <span className={styles.ok}><span className={styles.okMark} aria-hidden="true" />Connected</span> : null}
            </div>
            <p className={styles.does}>{a.name === "Grok web" ? "Connect on grok.com or in Grok Bot desktop." : a.does}</p>
            <Button variant="secondary" size="sm" onClick={() => { setGrokSurface("Grok web"); setOpen(a.name === "Grok web" ? "Grok" : a.name); }} aria-label={`Set up ${a.name === "Grok web" ? "Grok" : a.name}`}>Set up</Button>
          </li>
        ))}
      </ul>
      </>}


      <section className={styles.can} aria-labelledby="can-title">
        <div className={styles.canHead}>
          <h2 id="can-title" className={styles.chatTitle}>What your AI can do here</h2>
          <a href="/settings?tab=ai" className={styles.manage}>Manage apps and approving</a>
        </div>
        <div className={styles.canGrid}>
          {CONNECTOR_CATALOG.map((g) => (
            <div key={g.key} className={styles.canCol} data-group={g.key}>
              <h3 className={styles.canTitle}><span className={styles.canDot} aria-hidden="true" />{g.title}</h3>
              <p className={styles.muted}>{g.note}</p>
              <ul className={styles.canList}>{g.items.map((i) => <li key={i.label}>{i.label}</li>)}</ul>
            </div>
          ))}
        </div>
        <p className={styles.muted}>{APP_ONLY}</p>
      </section>

      <Dialog open={current !== undefined} onOpenChange={(o) => { if (!o) setOpen(null); }}>
        {current && (
          <DialogContent title={`Connect ${open}`} description={open === "Grok" ? "Choose where you use Grok. Each has its own sign-in." : current.does} className={styles.dialog}>
            <div className={styles.dialogBody}>
            {aiBrand(current.mark ?? current.name) && <div className={styles.connectionMarks} aria-hidden="true">
              <span><AiMark name={current.mark ?? current.name} size={28} /></span>
              {/* eslint-disable-next-line @next/next/no-img-element -- fixed local product icon */}
              <img src="/icon-192.png" width={48} height={48} alt="" />
            </div>}
            {open === "Grok" && <div className={styles.surfaceChoice} role="group" aria-label="Where you use Grok">
              <button type="button" aria-pressed={grokSurface === "Grok web"} onClick={() => setGrokSurface("Grok web")}>Web</button>
              <button type="button" aria-pressed={grokSurface === "Grok Bot desktop"} onClick={() => setGrokSurface("Grok Bot desktop")}>Grok Bot desktop</button>
            </div>}
            {current.image && <img className={styles.shot} src={current.image} alt={`Where Queue Pilot is added in ${current.name}`} width={1200} height={750} />}
            <div className={styles.address}>
              <span className={styles.label}><Term term="Connector URL, or MCP server URL" note="Claude calls it a custom connector URL, ChatGPT a server URL. They all mean this address.">Queue Pilot's address</Term></span>
              <code className={styles.code}>{connectorUrl}</code>
              <CopyButton value={connectorUrl} label="Copy" />
            </div>
            <ol className={styles.steps}>{current.steps.map((st) => <li key={st}>{st}</li>)}</ol>
            {current.setupPrompt && <CopyButton value={current.setupPrompt(connectorUrl)} label="Copy setup request" />}
            <p className={styles.muted}>{current.plan}</p>
            {!current.setupPrompt && <CopyButton value={CONNECTION_CHECK} label="Copy connection check" />}
            {current.help && <p className={styles.muted}>{current.help}</p>}
            {current.docs && <a href={current.docs} target="_blank" rel="noreferrer">Official {current.name} instructions</a>}
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
