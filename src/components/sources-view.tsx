"use client";

import { BUFFER_CHANNELS_URL } from "@/lib/connect-links";
import { ArrowUpRight } from "lucide-react";

import { SignInButton } from "./sign-in-button";

import { useState, useTransition } from "react";
import { ConfirmButton } from "./confirm-button";
import { Button } from "@/registry/components/button/button";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { Input } from "@/registry/components/input/input";
import { addSource, checkTelegramConnect, disconnectEcho, discordInstallLink, removeSource, telegramConnectInfo } from "@/app/(app)/actions";
import { Switch } from "@/registry/components/switch/switch";
import { CopyButton } from "@/registry/components/copy-button/copy-button";
import { AiMark } from "./ai-mark";
import { channelCheck } from "@/lib/preflight";
import { channels } from "@/lib/demo-data";
import { ChannelIcon } from "./channel-icon";
import styles from "./sources-view.module.css";

export type LiveChannel = { id: string; name: string; service: string; isDisconnected: boolean; isLocked: boolean; isQueuePaused: boolean };

/** Example mode shows the illustrative setup; live mode shows the signed-in account's real channels and connection state. */
export type LiveSource = { id: string; title: string; url: string };
export type LiveCopy = { kind: "telegram" | "discord"; label: string };
export type SourcesProps =
  | { mode: "example"; connectorUrl: string }
  | { mode: "live"; channels: LiveChannel[]; connectorUrl: string; sources: LiveSource[]; copies: LiveCopy[]; discordResult: string | null };

const LIVE_AI = [
  { name: "Claude", how: "Add Queue Pilot as a custom connector in Claude", plan: "Your Claude plan" },
  { name: "Grok", how: "Add Queue Pilot as a connector on grok.com", plan: "Your Grok plan" },
  { name: "ChatGPT", how: "Add Queue Pilot as a connector in ChatGPT", plan: "Your ChatGPT plan" },
];



/** The example account's sources, shown on the same screen a signed-in person sees. */
const EXAMPLE = {
  channels: channels.map((c) => ({ id: c.id, name: c.name, service: c.service, isDisconnected: c.isDisconnected, isLocked: false, isQueuePaused: c.isQueuePaused })),
  sources: [
    { id: "example-newsletter", title: "Weeknight Dinners", url: "https://weeknightdinners.example/feed" },
    { id: "example-youtube", title: "Weeknight Dinners on YouTube", url: "https://youtube.example/weeknightdinners" },
  ],
  copies: [{ kind: "telegram" as const, label: "@weeknightdinners" }],
  discordResult: null,
};

/** Sources: the signed-in person's own, or the example account's on the same screen. */
export function SourcesView(props: SourcesProps) {
  return props.mode === "live" ? <LiveSources {...props} /> : <LiveSources mode="live" connectorUrl={props.connectorUrl} {...EXAMPLE} />;
}

function LiveSources({ channels, connectorUrl, sources, copies, discordResult }: Extract<SourcesProps, { mode: "live" }>) {
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Where your drafts come from</h1>
        <p className={styles.sub}>What Queue Pilot reads before it drafts: your newsletter, blog, YouTube or GitHub releases. Drafts start from your own work.</p>
      </header>

      <section aria-labelledby="ch" className={styles.block}>
        <div className={styles.blockHead}>
          <h2 id="ch" className={styles.h2}>Your Buffer channels</h2>
        </div>
        {channels.length === 0 ? (
          <div className={styles.emptyRow}><p className={styles.does}>No channels in this Buffer account yet. Once you connect one in Buffer, it shows up here.</p><a className={styles.connectBtn} href={BUFFER_CHANNELS_URL} target="_blank" rel="noreferrer">Add a channel <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" /></a></div>
        ) : (
          <ul className={styles.rows}>
            {channels.map((c) => {
              const check = channelCheck(c);
              return (
                <li key={c.id} className={styles.row}>
                  <div className={styles.name}>
                    <strong className={styles.channel}><ChannelIcon service={c.service} size={18} />{c.name}</strong>
                  </div>
                  <span className={styles.does}>{check.detail}</span>
                  <span />
                  <span className={check.result === "pass" ? styles.ok : styles.bad}>
                    <span className={check.result === "pass" ? styles.okMark : styles.badMark} aria-hidden="true" />
                    {check.result === "pass" ? "Can post" : "Cannot post"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="ai" className={styles.block}>
        <div className={styles.blockHead}>
          <h2 id="ai" className={styles.h2}>Your AI</h2>
        </div>
        <div className={styles.aiCard}>
          <div className={styles.aiTop}>
            <span className={styles.aiMarks} aria-hidden="true">{LIVE_AI.map((a) => <AiMark key={a.name} name={a.name} size={18} />)}</span>
            <p className={styles.does}>Claude, ChatGPT and Grok add Queue Pilot as a connector with this URL.</p>
          </div>
          <div className={styles.address}>
            <code className={styles.code}>{connectorUrl}</code>
            <CopyButton value={connectorUrl} label="Copy URL" />
          </div>
          <a className={styles.link} href="/connect">Step-by-step for each app</a>
        </div>
      </section>

      <section aria-labelledby="mat" className={styles.block}>
        <div className={styles.blockHead}>
          <h2 id="mat" className={styles.h2}>Your material</h2>
        </div>
        <Material sources={sources} />
      </section>

      <section aria-labelledby="copies" className={styles.block}>
        <div className={styles.blockHead}>
          <h2 id="copies" className={styles.h2}>Copies to Telegram and Discord</h2>
        </div>
        <p className={styles.foot}>After Buffer publishes a post, Queue Pilot posts the same text in your Telegram channel and Discord channel. It looks for newly published posts once a day on its own, and again whenever you open Queue Pilot or your AI uses it, so a copy can arrive a while after the post.</p>
        <Copies copies={copies} discordResult={discordResult} />
      </section>
    </div>
  );
}

/** The feeds the user's AI drafts from: add by URL (checked once before saving), remove one at a time. */
function Material({ sources }: { sources: LiveSource[] }) {
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const { toast } = useToastStack();
  // A success becomes a short message in the corner; a problem stays next to the button that caused it.
  const say = (m: NonNullable<typeof message>) => { if (m.tone === "ok") { toast({ type: "success", title: m.text }); setMessage(null); } else setMessage(m); };
  const [pending, start] = useTransition();

  const add = () =>
    start(async () => {
      const res = await addSource(url);
      if (res.ok) {
        setUrl("");
        say({ tone: "ok", text: `Added ${res.title}.` });
      } else setMessage({ tone: "bad", text: res.message });
    });

  return (
    <>
      {sources.length > 0 ? (
        <ul className={styles.rows}>
          {sources.map((s) => (
            <li key={s.id} className={styles.row}>
              <div className={styles.name}>
                <strong>{s.title}</strong>
                <span className={styles.muted}>{s.url}</span>
              </div>
              <span />
              <span />
              <ConfirmButton variant="secondary" label="Remove" ariaLabel={`Remove ${s.title}`} question="Stop drafting from this feed?" confirmLabel="Remove feed" pending={pending}
                onConfirm={() => start(async () => { const r = await removeSource(s.id); say(r.ok ? { tone: "ok", text: `Removed ${s.title}.` } : { tone: "bad", text: r.message ?? "Queue Pilot could not remove it just now." }); })} />
            </li>
          ))}
        </ul>
      ) : (
        <p className={styles.foot}>Nothing added yet. Add the feed of your newsletter, blog, YouTube channel or GitHub releases.</p>
      )}
      <form
        className={styles.addForm}
        onSubmit={(e) => {
          e.preventDefault();
          if (url.trim()) add();
        }}
      >
        <Input
          label="Feed address"
          type="url"
          inputMode="url"
          placeholder="https://"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          error={message?.tone === "bad" ? message.text : undefined}
        />
        <Button type="submit" variant="primary" disabled={pending || !url.trim()}>
          {pending ? "Checking the feed…" : "Add feed"}
        </Button>
      </form>
      <p className={styles.addHint}>For example yourname.substack.com/feed or github.com/you/app/releases.atom</p>
      {message?.tone === "ok" && <p className={styles.foot} role="status">{message.text}</p>}
    </>
  );
}

const DISCORD_RESULT: Record<string, { tone: "ok" | "bad"; text: string }> = {
  connected: { tone: "ok", text: "Discord is connected." },
  expired: { tone: "bad", text: "That link expired. Press Add to server again." },
  failed: { tone: "bad", text: "Discord did not finish connecting. Try again." },
  "no-channel": { tone: "bad", text: "The bot cannot see a text channel in that server. Give it access to one and try again." },
  slow: { tone: "bad", text: "Too many connection attempts in the last hour. Try again later." },
  "not-set-up": { tone: "bad", text: "Discord copies turn on once Queue Pilot's Discord bot is set up." },
  "signed-out": { tone: "bad", text: "Sign in with Buffer, then add the bot again." },
};

/** Connect or disconnect the Telegram channel and Discord channel that get copies of sent posts. */
function Copies({ copies, discordResult }: { copies: LiveCopy[]; discordResult: string | null }) {
  const [pending, start] = useTransition();
  const [steps, setSteps] = useState<{ bot: string; code: string } | null>(null);
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(discordResult ? DISCORD_RESULT[discordResult] ?? null : null);
  const { toast } = useToastStack();
  // A success becomes a short message in the corner; a problem stays next to the button that caused it.
  const say = (m: NonNullable<typeof message>) => { if (m.tone === "ok") { toast({ type: "success", title: m.text }); setMessage(null); } else setMessage(m); };
  const tg = copies.find((c) => c.kind === "telegram");
  const dc = copies.find((c) => c.kind === "discord");

  const startTelegram = () =>
    start(async () => {
      const res = await telegramConnectInfo();
      if (res.ok) setSteps({ bot: res.bot, code: res.code });
      else setMessage({ tone: "bad", text: res.message });
    });
  const checkTelegram = () =>
    start(async () => {
      const res = await checkTelegramConnect();
      if (res.ok) {
        setSteps(null);
        say({ tone: "ok", text: `Telegram is connected to ${res.title}.` });
      } else setMessage({ tone: "bad", text: res.message });
    });
  const addDiscord = () =>
    start(async () => {
      const res = await discordInstallLink();
      if (res.ok) window.location.assign(res.url);
      else setMessage({ tone: "bad", text: res.message });
    });
  const stop = (kind: LiveCopy["kind"]) => start(async () => {
    const r = await disconnectEcho(kind);
    say(r.ok ? { tone: "ok", text: "Copies stopped." } : { tone: "bad", text: r.message ?? "Queue Pilot could not stop the copies just now." });
  });

  return (
    <>
      <ul className={styles.rows}>
        <li className={styles.row}>
          <div className={styles.name}>
            <strong>Telegram</strong>
            <span className={styles.muted}>{tg ? tg.label : "A channel you own"}</span>
          </div>
          <span className={styles.does}>{tg ? "Gets copies of your sent posts" : "Add the Queue Pilot bot as an admin, then post a code"}</span>
          <span />
          {tg ? (
            <ConfirmButton variant="secondary" label="Stop copying" question="Stop sending copies to Telegram?" confirmLabel="Stop copies" pending={pending} onConfirm={() => stop("telegram")} />
          ) : (
            <Button variant="secondary" size="sm" disabled={pending} onClick={startTelegram}>Connect</Button>
          )}
        </li>
        <li className={styles.row}>
          <div className={styles.name}>
            <strong>Discord</strong>
            <span className={styles.muted}>{dc ? dc.label : "A server where you can add bots"}</span>
          </div>
          <span className={styles.does}>{dc ? "Gets copies of your sent posts" : "Adds the Queue Pilot bot; it posts in your announcements channel"}</span>
          <span />
          {dc ? (
            <ConfirmButton variant="secondary" label="Stop copying" question="Stop sending copies to Discord?" confirmLabel="Stop copies" pending={pending} onConfirm={() => stop("discord")} />
          ) : (
            <Button variant="secondary" size="sm" disabled={pending} onClick={addDiscord}>Add to server</Button>
          )}
        </li>
      </ul>
      {steps && (
        <ol className={styles.steps}>
          <li>In Telegram, open your channel, then Administrators, and add <code className={styles.code}>@{steps.bot}</code>.</li>
          <li>Post this message in the channel: <code className={styles.code}>/connect {steps.code}</code></li>
          <li>
            <Button variant="primary" size="sm" disabled={pending} onClick={checkTelegram}>{pending ? "Checking…" : "I posted it"}</Button>
          </li>
        </ol>
      )}
      {message && <p className={message.tone === "ok" ? styles.foot : styles.bad} role="status">{message.text}</p>}
    </>
  );
}
