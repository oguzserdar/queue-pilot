import { headers } from "next/headers";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { getAuth } from "@/lib/auth";
import { Check, Link2 } from "lucide-react";
import { ConsentForm } from "./consent-form";
import styles from "./consent.module.css";

/** Plain-language meaning of each scope an AI client may ask for. Unknown scopes are listed as-is. */
const SCOPE_TEXT: Record<string, string> = {
  openid: "Know which Queue Pilot account you are",
  profile: "See your name and picture",
  email: "See your email address",
  offline_access: "Stay connected until you disconnect it",
};

/** A readable name for the AI client: the host of a Client ID Metadata Document URL, or the registered id. */
function clientLabel(clientId: string): string {
  try {
    return new URL(clientId).host;
  } catch {
    return clientId;
  }
}

export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const auth = await getAuth();
  const query = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => (Array.isArray(v) ? v.map((x) => [k, x]) : v === undefined ? [] : [[k, v]]))).toString();

  // The signed query proves this consent request came from our own /oauth2/authorize and was not edited.
  const valid = auth ? await verifyOAuthQueryParams(query, (await auth.$context).secret) : false;
  const session = valid && auth ? await auth.api.getSession({ headers: await headers() }) : null;

  if (!valid || !session) {
    return (
      <main className={styles.page}>
        <h1 className={styles.title}>This link has expired</h1>
        <p className={styles.sub}>Start connecting again from your AI. The request may be older than a few minutes, or it was changed.</p>
      </main>
    );
  }

  const client = clientLabel(String(params.client_id ?? ""));
  const scopes = String(params.scope ?? "").split(" ").filter(Boolean);
  const { name, email, image } = session.user;
  return (
    <main className={styles.page}>
      <section className={styles.card} aria-labelledby="consent-title">
        {/* The asking app and Queue Pilot side by side, the way sign-in consent screens show who connects to whom. */}
        <div className={styles.pair} aria-hidden="true">
          <span className={styles.clientTile}>{client.replace(/^www\./, "").charAt(0).toUpperCase()}</span>
          <span className={styles.link}><Link2 size={16} strokeWidth={2} /></span>
          {/* eslint-disable-next-line @next/next/no-img-element -- a fixed local icon, no optimisation needed */}
          <img className={styles.appTile} src="/icon-192.png" alt="" width={56} height={56} />
        </div>
        <h1 id="consent-title" className={styles.title}><strong>{client}</strong> wants to work with your Buffer queue</h1>
        <div className={styles.account}>
          {image
            ? /* eslint-disable-next-line @next/next/no-img-element -- the person's own Buffer picture */ <img className={styles.avatar} src={image} alt="" width={32} height={32} />
            : <span className={styles.avatar} aria-hidden="true">{(name || email).charAt(0).toUpperCase()}</span>}
          <span className={styles.who}><span className={styles.name}>{name || email}</span>{name ? <span className={styles.email}>{email}</span> : null}</span>
        </div>
        <div className={styles.can}>
          <p className={styles.canTitle}>It will be able to</p>
          <ul className={styles.scopes}>
            <li><Check size={16} strokeWidth={2.5} aria-hidden="true" />Read your posting slots and posts</li>
            <li><Check size={16} strokeWidth={2.5} aria-hidden="true" />Save drafts in your queue</li>
            {scopes.map((s) => <li key={s}><Check size={16} strokeWidth={2.5} aria-hidden="true" />{SCOPE_TEXT[s] ?? s}</li>)}
          </ul>
        </div>
        <p className={styles.note}>It cannot schedule or publish anything. Only your Approve schedules a post.</p>
        <ConsentForm />
      </section>
    </main>
  );
}
