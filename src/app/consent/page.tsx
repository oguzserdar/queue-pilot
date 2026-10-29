import { headers } from "next/headers";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { getAuth } from "@/lib/auth";
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

  const clientId = String(params.client_id ?? "");
  const scopes = String(params.scope ?? "").split(" ").filter(Boolean);
  return (
    <main className={styles.page}>
      <div className={styles.mark}>Queue Pilot<span>.</span></div>
      <h1 className={styles.title}>Allow {clientLabel(clientId)} to work with your Buffer queue?</h1>
      <p className={styles.sub}>Signed in as {session.user.email}. It can read your posting slots and posts, and save drafts. It cannot schedule or publish anything: you approve every post.</p>
      <ul className={styles.scopes}>
        {scopes.map((s) => <li key={s}>{SCOPE_TEXT[s] ?? s}</li>)}
      </ul>
      <ConsentForm />
    </main>
  );
}
