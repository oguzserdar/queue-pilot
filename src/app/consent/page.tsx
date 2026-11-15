import { headers } from "next/headers";
import { verifyOAuthQueryParams } from "@better-auth/oauth-provider";
import { getAuth } from "@/lib/auth";
import { consentClientLabel } from "@/lib/ai-access";
import { ConsentCard } from "./consent-card";
import { ConsentForm } from "./consent-form";
import styles from "./consent.module.css";
import Image from "next/image";

/** One search parameter as query pairs: a repeated key gives one pair per value, a missing one gives none. */
function queryPairs(key: string, value: string | string[] | undefined): [string, string][] {
  if (Array.isArray(value)) return value.map((x) => [key, x]);
  return value === undefined ? [] : [[key, value]];
}

export default async function ConsentPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const auth = await getAuth();
  const query = new URLSearchParams(Object.entries(params).flatMap(([k, v]) => queryPairs(k, v))).toString();

  // The signed query proves this consent request came from our own /oauth2/authorize and was not edited.
  const valid = auth ? await verifyOAuthQueryParams(query, (await auth.$context).secret) : false;
  const session = valid && auth ? await auth.api.getSession({ headers: await headers() }) : null;

  if (!valid || !session) {
    return (
      <main className={styles.page}>
        <section className={styles.card} aria-labelledby="expired-title">
          <Image className={styles.expiredIcon} src="/icon-192.png" alt="Queue Pilot" width={56} height={56} />
          <h1 id="expired-title" className={styles.title}>This link has expired</h1>
          <p className={styles.sub}>Start connecting again from your AI to get a fresh permission request.</p>
          <a className={styles.helpLink} href="/connect">Connection setup</a>
        </section>
      </main>
    );
  }

  const client = await consentClientLabel(String(params.client_id ?? ""));
  return <ConsentCard client={client} clientId={String(params.client_id ?? "")} redirectUri={String(params.redirect_uri ?? "")} user={session.user} scopes={String(params.scope ?? "").split(" ").filter(Boolean)}><ConsentForm /></ConsentCard>;
}
