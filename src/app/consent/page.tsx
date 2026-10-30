import { headers } from "next/headers";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { getAuth } from "@/lib/auth";
import { ConsentCard } from "./consent-card";
import { ConsentForm } from "./consent-form";
import styles from "./consent.module.css";

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
        <section className={styles.card} aria-labelledby="expired-title">
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed local product icon */}
          <img className={styles.expiredIcon} src="/icon-192.png" alt="Queue Pilot" width={56} height={56} />
          <h1 id="expired-title" className={styles.title}>This link has expired</h1>
          <p className={styles.sub}>Start connecting again from your AI to get a fresh permission request.</p>
          <a className={styles.helpLink} href="/connect">Connection setup</a>
        </section>
      </main>
    );
  }

  return <ConsentCard client={clientLabel(String(params.client_id ?? ""))} user={session.user} scopes={String(params.scope ?? "").split(" ").filter(Boolean)}><ConsentForm /></ConsentCard>;
}
