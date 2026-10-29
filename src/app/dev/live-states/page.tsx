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

/** Development only: the signed-in Ideas, Voice and Week screens, for screenshots and the layout gate. Production answers 404. */
export default async function Page({ searchParams }: { searchParams: Promise<{ screen?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const asked = (await searchParams).screen;
  const screen = asked === "voice" || asked === "settings" || asked === "week" || asked === "playbook" ? asked : "ideas";
  if (screen === "playbook") {
    const shell: ShellAccount = { email: "mark@weeknightdinners.example", channelCount: 4, fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(), needsRefresh: false, name: "Mark Evans", image: null };
    return <AppShell account={shell} signInOpen><PlaybookView mode="live" initial={[]} reader={devReadRule} /></AppShell>;
  }
  if (screen === "week") {
    // The example week as a signed-in person sees it: the empty slot has an id.
    const week = { ...demoWeek, slotIds: { [slotKey("linkedin", 4, "12:00")]: "dev-linkedin-fri" } };
    const shell: ShellAccount = { email: "mark@weeknightdinners.example", channelCount: 4, fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(), needsRefresh: false, name: "Mark Evans", image: null };
    return <AppShell account={shell} signInOpen><WeekView week={week} live verdicts={{}} hasAiKey /></AppShell>;
  }
  const account: ShellAccount = { email: "mark@weeknightdinners.example", channelCount: 3, fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(), needsRefresh: false, name: "Mark Evans", image: null };
  return <AppShell account={account} signInOpen>{screen === "settings" ? <SettingsView account={{ email: "mark@weeknightdinners.example", name: "Mark Evans", image: null, channelNames: ["X", "LinkedIn", "Bluesky"], rateLimit: [{ policy: "250-in-24h", remaining: 212 }], apps: [{ consentId: "k1", name: "Claude", site: "https://claude.ai", approvedAt: "2026-11-02T10:00:00Z", lastUsedAt: "2026-11-02T10:40:00.000Z", calls: 14 }, { consentId: "k2", name: "ChatGPT", site: null, approvedAt: "2026-10-30T10:00:00Z", lastUsedAt: null, calls: 0 }], devices: [{ id: "s1", device: "Chrome on Mac", lastActive: "2026-11-03T12:00:00Z", current: true }, { id: "s2", device: "Safari on iPhone", lastActive: "2026-11-02T08:14:00Z", current: false }] }} /> : screen === "voice" ? <VoiceView
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
