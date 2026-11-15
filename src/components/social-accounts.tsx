"use client";

/**
 * The Mastodon and Bluesky accounts a person connected, on the Channels tab: each with its handle, whether automatic
 * replies are on, and Disconnect; an account the network stopped accepting asks to be connected again. Below them, the
 * two ways to connect: Mastodon through the person's own instance, Bluesky with an app password.
 */
import { useState, useTransition } from "react";
import { Button } from "@/registry/components/button/button";
import { Input } from "@/registry/components/input/input";
import { PasswordField } from "@/registry/components/password-field/password-field";
import { Switch } from "@/registry/components/switch/switch";
import type { SocialAccountView } from "@/lib/social-accounts";
import { connectBlueskyAction, disconnectSocialAction, setRepliesAction } from "@/app/(app)/social-actions";
import { PostingTimesEditor } from "./posting-times-editor";
import { ConfirmButton } from "./confirm-button";
import styles from "./settings-view.module.css";
import channelStyles from "./sources-view.module.css";

const NETWORK = { mastodon: "Mastodon", bluesky: "Bluesky" } as const;

/** The words for a Mastodon connect result arriving in the address (?mastodon=...). */
export const MASTODON_RESULT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Mastodon account connected." },
  expired: { ok: false, text: "That Mastodon sign-in expired or did not match. Press Connect again." },
  "bad-address": { ok: false, text: "That address is not a public https server. Type your instance, like mastodon.social." },
  unreachable: { ok: false, text: "Queue Pilot could not reach that instance. Check the address, or try again in a minute." },
  "signed-out": { ok: false, text: "Sign in first." },
  slow: { ok: false, text: "Too many tries just now. Wait a minute and try again." },
  "not-set-up": { ok: false, text: "This Queue Pilot is not set up to keep account sign-ins (SETTINGS_KEY is missing)." },
};
const fallback = { ok: false, text: "The Mastodon account was not connected. Try again." };

/**
 * @param accounts - The person's connected accounts; null when they could not be read
 * @param mastodonResult - The code the Mastodon callback sent back, if any
 * @param example - The signed-out example: every control answers "Sign in with Buffer first"
 */
export function SocialAccounts({ accounts, mastodonResult, example = false }: { accounts: SocialAccountView[] | null; mastodonResult?: string | null; example?: boolean }) {
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(mastodonResult ? MASTODON_RESULT[mastodonResult] ?? fallback : null);
  const [pending, start] = useTransition();
  const [handle, setHandle] = useState("");
  const [appPassword, setAppPassword] = useState("");
  const act = (run: () => Promise<{ ok: boolean; message: string }>) =>
    start(async () => {
      if (example) { setNote({ ok: false, text: "Sign in first." }); return; }
      const r = await run().catch(() => ({ ok: false, message: "Queue Pilot did not answer. Try again." }));
      setNote({ ok: r.ok, text: r.message });
    });

  return (
    <section className={styles.block} aria-labelledby="social">
      <h2 id="social" className={styles.h2}>Mastodon and Bluesky</h2>
      <p className={channelStyles.foot}>Accounts Queue Pilot posts to directly, and can answer mentions on. Replies start off. Turn them on and Queue Pilot answers new mentions in your voice under your rules, from that moment on, never older ones. A reply your rules or the judge stop is not sent: it waits in the inbox with the reason.</p>
      {note && <p className={note.ok ? styles.saved : styles.problem} role="status">{note.text}</p>}
      {accounts === null ? <p className={styles.muted}>Your accounts could not be read just now.</p> : accounts.length > 0 && (
        <div className={styles.rows}>
          {accounts.map((a) => (
            <div key={a.id} className={styles.row}>
              <div className={styles.name}>
                <strong>{a.handle}</strong>
                <span className={styles.muted}>{NETWORK[a.network]}{a.broken ? " · stopped accepting Queue Pilot's sign-in. Connect it again below." : ""}</span>
              </div>
              <div className={styles.confirm}>
                <PostingTimesEditor accountId={a.id} handle={a.handle} schedule={a.postingSchedule} timeZone={a.timeZone} disabled={pending || a.broken} onSaved={(r) => setNote({ ok: r.ok, text: r.message })} />
                <Switch label="Replies" checked={a.repliesOn} disabled={pending || a.broken} onCheckedChange={(on) => act(() => setRepliesAction(a.id, on))} />
                <ConfirmButton variant="secondary" label="Disconnect" question={`Disconnect ${a.handle}? Posts and replies to it stop.`} confirmLabel={`Disconnect ${NETWORK[a.network]}`} pending={pending} onConfirm={() => act(() => disconnectSocialAction(a.id))} />
              </div>
            </div>
          ))}
        </div>
      )}
      <form className={styles.deleteForm} action="/api/mastodon/start" method="post" onSubmit={(e) => { if (example) { e.preventDefault(); setNote({ ok: false, text: "Sign in first." }); } }}>
        <Input name="instance" label="Your Mastodon instance" placeholder="mastodon.social" autoComplete="off" spellCheck={false} required />
        <div className={styles.deleteActions}><Button type="submit" variant="secondary" size="sm">Connect Mastodon</Button></div>
      </form>
      <form className={styles.deleteForm} onSubmit={(e) => { e.preventDefault(); act(async () => { const r = await connectBlueskyAction({ handle, appPassword }); if (r.ok) { setHandle(""); setAppPassword(""); } return r; }); }}>
        <Input label="Your Bluesky handle" placeholder="ada.bsky.social" autoComplete="off" spellCheck={false} value={handle} onChange={(e) => setHandle(e.target.value)} required />
        <PasswordField label="A Bluesky app password, never your account password" description="Make one in Bluesky: Settings, Privacy and security, App passwords." autoComplete="off" spellCheck={false} value={appPassword} onChange={(e) => setAppPassword(e.target.value)} required />
        <div className={styles.deleteActions}><Button type="submit" variant="secondary" size="sm" loading={pending}>Connect Bluesky</Button></div>
      </form>
    </section>
  );
}
