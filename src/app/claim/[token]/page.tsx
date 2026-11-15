/**
 * /claim/{token}: the page a claim link opens (sign-up contract §5, route "link").
 *
 * Signed out: the agent's work is not shown; the person signs in with Buffer and comes straight back here.
 * Signed in: the agent's label and everything it saved, the address the agent named (partly hidden, with a warning
 * when it is not the person's), then Accept. Every other state is named with a next step: the link is unknown, it was
 * used, the account was claimed (by someone else, or by you, with what came with it), or it was deleted.
 *
 * The token is a bearer secret. This page never logs it, and it is not in any page the app links to.
 */
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { headers } from "next/headers";
import { getAuth } from "@/lib/auth";
import { claimView, type ClaimView } from "@/lib/agent-signup/claim";
import type { Artifact } from "@/lib/agent-signup/artifacts";
import { agentServer } from "@/lib/agent-signup/server";
import { acceptClaimAction } from "./actions";
import { ClaimSignIn } from "./claim-sign-in";
import styles from "./claim.module.css";

export const metadata: Metadata = { title: "Claim an agent's account", robots: { index: false, follow: false }, referrer: "no-referrer" };

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) + " UTC";
const agentName = (v: { tool: string | null; label: string | null }) => v.label ?? v.tool ?? "An AI agent";

/** The newest items by title, with the true total: the list stops at 50, and Accept takes them all. */
function Items({ title, items, total, empty }: { title: string; items: Artifact[]; total: number; empty: string }) {
  return (
    <section className={styles.section}>
      <h2 className={styles.sectionTitle}>{title} ({total})</h2>
      {items.length ? <ul className={styles.items}>{items.map((i) => <li key={i.id}>{i.title}</li>)}</ul> : <p className={styles.empty}>{empty}</p>}
      {total > items.length ? <p className={styles.empty}>and {total - items.length} more</p> : null}
    </section>
  );
}

function Card({ children }: { children: ReactNode }) {
  return <main className={styles.page}><section className={styles.card}>{children}</section></main>;
}

const REFUSED: Record<Exclude<ClaimView["state"], "open" | "yours">, { title: string; sub: string }> = {
  ticket_unknown: { title: "This claim link does not work", sub: "Check that the whole link was copied, or ask the agent for its link again: it is in every reply the agent gets." },
  ticket_used: { title: "This claim link was already used", sub: "If you claimed it, the agent's next reply says so. If you did not, tell the agent: that reply names who claimed it, partly hidden." },
  already_claimed: { title: "Someone else already claimed this account", sub: "If that was not you, tell the agent: its next reply names who claimed it, partly hidden." },
  account_deleted: { title: "This account is gone", sub: "Nobody claimed it in time, so it was deleted with what it saved. The agent can sign up again; ask it to." },
};

export default async function ClaimPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [auth, server] = await Promise.all([getAuth(), agentServer()]);
  if (!auth || !server) return <Card><h1 className={styles.title}>Queue Pilot is not open yet</h1><p className={styles.sub}>Try the link again later.</p></Card>;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) {
    return (
      <Card>
        <h1 className={styles.title}>Claim the account an AI agent made for you</h1>
        <p className={styles.sub}>An agent signed up to Queue Pilot and saved work for you. Sign in to see what it saved and take it onto your account.</p>
        <ClaimSignIn />
      </Card>
    );
  }

  const view = await claimView(server, token, { userId: session.user.id, email: session.user.email });
  if (view.state === "yours") {
    return (
      <Card>
        <h1 className={styles.title}><strong>{agentName(view)}</strong> is on your account</h1>
        <p className={styles.sub}>It keeps working with what it already had. Its material was added to your material; its drafts stay private here and were not sent to Buffer.</p>
        <Items title="Material" items={view.material} total={view.materialCount} empty="No material." />
        <Items title="Drafts" items={view.drafts} total={view.draftCount} empty="No drafts." />
        <a className={styles.link} href="/sources">Go to your material</a>
      </Card>
    );
  }
  if (view.state !== "open") return <Card><h1 className={styles.title}>{REFUSED[view.state].title}</h1><p className={styles.sub}>{REFUSED[view.state].sub}</p></Card>;

  return (
    <Card>
      <h1 className={styles.title}>Claim <strong>{agentName(view)}</strong>?</h1>
      <p className={styles.sub}>
        {view.tool ? `${view.tool}, ` : ""}first seen {when(view.firstSeen)}. {view.frozen ? "It is frozen until claimed. " : ""}If nobody claims it, it is deleted on {when(view.deleteAt)}.
      </p>
      {view.namedAddress ? (
        <p className={styles.warning}>
          {view.addressDiffers
            ? `The agent named ${view.namedAddress}, which is not the address you are signed in with. Claim only if you know this agent.`
            : `The agent named your address, ${view.namedAddress}.`}
        </p>
      ) : null}
      <Items title="Material it saved" items={view.material} total={view.materialCount} empty="No material yet." />
      <Items title="Drafts it wrote" items={view.drafts} total={view.draftCount} empty="No drafts yet." />
      <p className={styles.note}>Claiming adds the material to yours and keeps the drafts private on your account. It does not post, schedule or send anything, and it gives the agent no access to your Buffer or to admin tools.</p>
      <form action={acceptClaimAction.bind(null, token)} className={styles.actions}>
        <button type="submit" className={styles.primary}>Claim this account</button>
      </form>
    </Card>
  );
}
