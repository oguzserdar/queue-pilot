import { channels as exampleChannels } from "@/lib/example-channels";
import { notFound } from "next/navigation";
import { AppShell, type ShellAccount } from "@/components/app-shell";
import { BriefingView } from "@/components/briefing-view";
import { VoiceView } from "@/components/voice-view";
import { SettingsView } from "@/components/settings-view";
import { WeekView } from "@/components/week-view";
import { PlaybookView } from "@/components/playbook-view";
import { devReadRule } from "./read-rule";
import { demoWeek } from "@/lib/demo-data";
import { slotKey } from "@/lib/week-model";
import { NeedsYouView } from "@/components/needs-you-view";
import type { TriageItem } from "@/lib/triage-model";

/** Development only: the signed-in Ideas, Voice and Week screens, for screenshots and the layout gate. Production answers 404. */
export default async function Page({ searchParams }: { searchParams: Promise<{ screen?: string; channels?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const asked = params.screen;
  const channelCount = params.channels === "1" ? 1 : params.channels === "2" ? 2 : 4;
  const shellChannels = exampleChannels.slice(0, channelCount).map(c => ({ ...c, name: c.handle }));
  const screen = asked === "voice" || asked === "settings" || asked === "week" || asked === "playbook" || asked === "needs" ? asked : "ideas";
  if (screen === "needs") {
    // Example rows, not live: approving folds the row away without calling Buffer.
    const at = (i: number, title: string, time: string, account: string): TriageItem => ({ id: `approve-${i}`, kind: "approve", title, detail: `${time} · ${account}`, href: "/week", action: "Approve", postId: `p${i}`, run: "approve" });
    const triage = [at(1, "Queue Pilot opens review links on Monday.", "Mon 9:00", "Company"), at(2, "On Monday, QP adds account-specific rules.", "Mon 12:00", "Company"), at(3, "I am building QP around my edits.", "Tue 9:00", "Personal"), at(4, "Why one clear point beats three.", "Wed 9:00", "Personal")];
    const shell: ShellAccount = { email: "mark@weeknightdinners.example", channels: shellChannels, fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(), needsRefresh: false, name: "Mark Evans", image: null };
    return <AppShell account={shell} signInOpen><NeedsYouView needs={[]} readiness={[]} greeting="Good evening" triage={triage} /></AppShell>;
  }
  if (screen === "playbook") {
    const shell: ShellAccount = { email: "mark@weeknightdinners.example", channels: shellChannels, fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(), needsRefresh: false, name: "Mark Evans", image: null };
    return <AppShell account={shell} signInOpen><PlaybookView mode="live" initial={[]} reader={devReadRule} /></AppShell>;
  }
  if (screen === "week") {
    // The example week as a signed-in person sees it: the empty slot has an id.
    const week = { ...demoWeek, slotIds: { [slotKey("linkedin", 4, "12:00")]: "dev-linkedin-fri" } };
    const shell: ShellAccount = { email: "mark@weeknightdinners.example", channels: shellChannels, fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(), needsRefresh: false, name: "Mark Evans", image: null };
    return <AppShell account={shell} signInOpen><WeekView week={week} live verdicts={{}} writing={{ ready: true, source: "built-in AI" }} writeCount={10} notesPreview={Object.fromEntries(week.posts.map((p) => [p.id, [{ id: "n2", author: "Sara Lee", createdAt: "2026-11-04T09:12:00Z", text: "Can we use the photo from Sunday instead? The bowl shot is darker.", canEdit: false, canDelete: false }, { id: "n1", author: "Mark Evans", createdAt: "2026-11-03T17:40:00Z", text: "Checked the price against the newsletter: still $4.", canEdit: true, canDelete: true }]]))} /></AppShell>;
  }
  const account: ShellAccount = { email: "mark@weeknightdinners.example", channels: exampleChannels.slice(0, 3).map(c => ({ ...c, name: c.handle })), fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(), needsRefresh: false, name: "Mark Evans", image: null };
  return <AppShell account={account} signInOpen>{screen === "settings" ? <SettingsView account={{ email: "mark@weeknightdinners.example", name: "Mark Evans", image: null, channelNames: ["X", "LinkedIn", "Bluesky"], rateLimit: [{ policy: "250-in-24h", remaining: 212 }], apps: [{ consentId: "k1", name: "Claude", brand: "Claude", site: "https://claude.ai", approvedAt: "2026-11-02T10:00:00Z", lastUsedAt: "2026-11-02T10:40:00.000Z", calls: 14, label: null, returnsTo: ["claude.ai"], unused: false }, { consentId: "k3", name: "Cursor", brand: "Cursor", site: null, approvedAt: "2026-11-02T21:00:00Z", lastUsedAt: "2026-11-02T10:20:00.000Z", calls: 31, label: "Grok Bot desktop", returnsTo: ["cursor.com", "This computer"], unused: false }, { consentId: "k4", name: "Cursor", brand: "Cursor", site: null, approvedAt: "2026-11-01T09:00:00Z", lastUsedAt: "2026-11-01T09:30:00.000Z", calls: 6, label: null, returnsTo: ["cursor.com"], unused: false }, { consentId: "k5", name: "Grok", brand: "Grok", site: null, approvedAt: "2026-11-01T08:00:00Z", lastUsedAt: "2026-11-02T03:00:00.000Z", calls: 9, label: null, returnsTo: ["grok.com"], unused: false }, { consentId: "k2", name: "ChatGPT", brand: "ChatGPT", site: null, approvedAt: "2026-09-30T10:00:00Z", lastUsedAt: null, calls: 0, label: null, returnsTo: ["chatgpt.com"], unused: true }], devices: [{ id: "s1", device: "Chrome on Mac", lastActive: "2026-11-03T12:00:00Z", current: true }, { id: "s2", device: "Safari on iPhone", lastActive: "2026-11-02T08:14:00Z", current: false }] }} /> : screen === "voice" ? <VoiceView
        mode="live"
        note="Short, plain, no emojis. One link at the end."
        examples={[{ postId: "p1", channel: "X", text: "Soup weather. Here is the one I make on repeat: white beans, kale, and the bread you were about to throw out." }]}
        candidates={[
          { postId: "p1", channel: "X", text: "Soup weather. Here is the one I make on repeat: white beans, kale, and the bread you were about to throw out." },
          { postId: "p2", channel: "LinkedIn", text: "We rebuilt export this month. Here is what we learned from 40 support tickets about CSV files, and the three changes that came out of them." },
          { postId: "p3", channel: "Bluesky", text: "New on the blog: why we stopped sending weekly digests nobody opened." },
        ]}
      /> : <BriefingView mode="live" />}</AppShell>;
}
