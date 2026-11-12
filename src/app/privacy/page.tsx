import type { Metadata } from "next";
import Link from "next/link";
import styles from "./privacy.module.css";

export const metadata: Metadata = {
  title: "Privacy | Queue Pilot",
  description: "What Queue Pilot stores, which services receive it, and how to manage or delete it.",
};

export default function PrivacyPage() {
  return (
    <main className={styles.page}>
      <Link href="/" className={styles.brand}>Queue Pilot<span>.</span></Link>
      <header className={styles.header}>
        <p className={styles.date}>Last updated 4 November 2026</p>
        <h1>Privacy</h1>
        <p>This notice covers the Queue Pilot service at getqueuepilot.com. Someone hosting their own copy of Queue Pilot controls that copy and its data separately.</p>
      </header>

      <section aria-labelledby="stored">
        <h2 id="stored">What Queue Pilot stores</h2>
        <p>Signing in with Buffer creates an account with your name, email and profile picture. Queue Pilot stores encrypted connection tokens, session information, and a saved copy of your Buffer channels, posting times and posts so it can show your queue without fetching it on every visit.</p>
        <p>It also stores the information you add or ask an assistant to save: writing examples and preferences, rules, source addresses, research, transcripts, source versions, quotes and draft checks. Draft and edit records let it suggest rules from repeated changes. Review links and comments, connected-app permissions, AI usage and security activity are stored to run those features.</p>
        <p>Buffer Notes, tags and ideas are read from or written to Buffer when you use those features. Notes can include their author and date. People with access to the relevant Buffer channel can see its notes.</p>
      </section>

      <section aria-labelledby="purpose">
        <h2 id="purpose">How the information is used</h2>
        <p>Queue Pilot uses this information to show your queue, draft in your style, check rules and source evidence, learn from edits, manage requested changes and protect account access. Usage records track AI allowances and costs. Session and security records can include your IP address and browser information.</p>
      </section>

      <section aria-labelledby="services">
        <h2 id="services">Services that receive information</h2>
        <ul>
          <li><strong>Buffer:</strong> receives the drafts, notes, tags and ideas you save there, and scheduling requests you authorize.</li>
          <li><strong>Connected AI apps:</strong> when you authorize an assistant, it can request account information, voice, rules, sources and drafts through Queue Pilot. Its tool results become available to that app. Connecting Queue Pilot does not itself give it access to your entire chat history or mailbox; an assistant may send excerpts you ask it to save.</li>
          <li><strong>AI providers:</strong> writing, checking and learning can send relevant drafts, voice examples, rules, source passages and edit or review evidence to Anthropic, OpenAI, or OpenRouter and the model provider it routes to. The provider depends on the configured built-in key or your own key. These providers have their own data-handling and retention terms.</li>
          <li><strong>Source services:</strong> transcript requests send a video address to Supadata. If Exa search is configured and used, Exa receives search queries or page addresses. Fetching feeds and pages also contacts the source website.</li>
          <li><strong>Hosting:</strong> Vercel serves the app. A hosted PostgreSQL database stores account and application records. Infrastructure providers process request and operational data. Data may be processed outside your country.</li>
          <li><strong>Optional destinations:</strong> if you set up copies to Telegram or Discord, the selected content is sent to those services.</li>
        </ul>
        <p>Check the privacy terms of the assistant and providers you use. Removing an app from Queue Pilot stops its future access; it does not erase information it has already received.</p>
      </section>

      <section aria-labelledby="sharing">
        <h2 id="sharing">Review links</h2>
        <p>Anyone with a review link can read its selected drafts and leave comments without an account. Only share drafts suitable for that audience. Links expire and can be turned off earlier. Turning one off does not remove copies someone has already made.</p>
      </section>

      <section aria-labelledby="cookies">
        <h2 id="cookies">Cookies and analytics</h2>
        <p>Queue Pilot uses cookies for sign-in and account sessions. It also uses <a href="https://vercel.com/docs/analytics/privacy-policy">Vercel Web Analytics</a> to understand page visits. Hosting and error logs may contain request information.</p>
      </section>

      <section aria-labelledby="controls">
        <h2 id="controls">Access, retention and deletion</h2>
        <p>In <Link href="/settings">Settings</Link>, you can export account data, remove connected AI apps, manage sessions and delete your Queue Pilot account. You can also remove individual writing examples, rules and sources in the app. Removing a feed does not remove drafts or previously saved source evidence.</p>
        <p>Account content remains stored until removed through the available controls or account deletion. Deleting the account removes its associated records from Queue Pilot’s active database, including stored connection tokens. An anonymous record that a deletion occurred remains. This does not delete posts or notes in Buffer, or data held by an AI app or another service. Infrastructure logs and backups follow their providers’ retention processes.</p>
        <p>Stored API keys and OAuth tokens are encrypted. They must be decrypted by the service when used; this is not end-to-end encryption. Revoking Queue Pilot in Buffer stops its Buffer access.</p>
      </section>

      <section aria-labelledby="contact">
        <h2 id="contact">Questions or requests</h2>
        <p>For privacy questions or requests, email <a href="mailto:privacy@getqueuepilot.com">privacy@getqueuepilot.com</a>. Changes to this notice will appear here with a new update date.</p>
      </section>
      <Link href="/" className={styles.back}>Back to Queue Pilot</Link>
    </main>
  );
}
