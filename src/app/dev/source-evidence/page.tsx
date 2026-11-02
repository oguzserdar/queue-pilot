import { notFound } from "next/navigation";
import { SourceEvidencePanel, EvidenceDetail } from "@/components/source-evidence";
import { AppShell } from "@/components/app-shell";
import type { EvidenceCard } from "@/lib/source-presentation";

/** Local UI fixture only. Never served in production or presented as a real account. */
export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  const card: EvidenceCard = { postId: "example", snapshotId: "example-source", title: "Release notes: export limits", uri: "https://example.com/releases", claim: "The export limit is 500 rows.", quote: "Exports support up to 500 rows.", locator: null, lastCheckedAt: "2026-11-01T20:30:00Z", needsCheck: true, changed: true, scheduled: false, editable: true, oldText: "Exports support up to 500 rows.", newText: "Exports support up to 1,000 rows. The new limit applies to every plan.", draftText: "The export limit is 500 rows. That should cover the small reports I send each week.", why: "The release now allows 1,000 rows, so this draft gives the old limit.", rewrite: "The export limit is now 1,000 rows on every plan. That should cover the small reports I send each week." };
  return <AppShell account={null} signInOpen={false}><div style={{ maxWidth: 1000, margin: "24px auto", padding: "0 20px" }}><h1>Source evidence</h1><p>Development example. These are not live drafts.</p><SourceEvidencePanel cards={[card]} /><h2>Evidence on a draft</h2><EvidenceDetail card={{ ...card, captions: "unknown", truncated: true, locator: "t=872", uri: "https://www.youtube.com/watch?v=QJf0H64BnFo" }} /></div></AppShell>;
}
