import type { Verdict } from "@/lib/judge";
import { channels as exampleChannels } from "@/lib/example-channels";
import { notFound } from "next/navigation";
import { ComposerPreview } from "./composer-preview";
import { AppShell, type ShellAccount } from "@/components/app-shell";
import { BriefingView } from "@/components/briefing-view";
import { VoiceView } from "@/components/voice-view";
import { SettingsView } from "@/components/settings-view";
import { WeekView } from "@/components/week-view";
import { PlaybookView } from "@/components/playbook-view";
import { devReadRule } from "./read-rule";
import { EXAMPLE_RULES } from "@/lib/example-playbook";
import { demoWeekFor } from "@/lib/demo-data";

// The dev page shows the written week.
const demoWeek = demoWeekFor(0);
import { slotKey } from "@/lib/week-model";
import { NeedsYouView } from "@/components/needs-you-view";
import type { TriageItem } from "@/lib/triage-model";

/** Development only: the signed-in Ideas, Voice and Week screens, for screenshots and the layout gate. Production answers 404. */
export default async function Page({ searchParams }: { searchParams: Promise<{ screen?: string; channels?: string; team?: string; notes?: string; tags?: string; problem?: string; video?: string; stale?: string; repeat?: string; fixes?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const asked = params.screen;
  const channelCount = params.channels === "1" ? 1 : params.channels === "2" ? 2 : 4;
  const shellChannels = exampleChannels.slice(0, channelCount).map(c => ({ ...c, name: c.handle }));
  const screen = asked === "voice" || asked === "settings" || asked === "week" || asked === "playbook" || asked === "needs" || asked === "composer" ? asked : "ideas";
  if (screen === "composer") {
    const shell: ShellAccount = { email: "alex@thisweekinai.example", channels: shellChannels, fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(), needsRefresh: false, name: "Alex Rivera", image: null };
    return <AppShell account={shell} signInOpen><ComposerPreview /></AppShell>;
  }
  if (screen === "needs") {
    // Example rows, not live: approving folds the row away without calling Buffer.
    const at = (i: number, title: string, time: string, account: string): TriageItem => ({ id: `approve-${i}`, kind: "approve", title, detail: `${time} · ${account}`, href: "/week", action: "Approve", postId: `p${i}`, run: "approve" });
    const triage = [at(1, "Queue Pilot opens review links on Monday.", "Mon 9:00", "Company"), at(2, "On Monday, QP adds account-specific rules.", "Mon 12:00", "Company"), at(3, "I am building QP around my edits.", "Tue 9:00", "Personal"), at(4, "Why one clear point beats three.", "Wed 9:00", "Personal"),
      // ?repeat=1: a fix Alex made in two drafts, waiting at the top.
      ...(params.repeat === "1" ? [{ id: "repeat-fixes", kind: "repeat", title: "You made the same fix in 2 drafts", detail: "Alex Rivera · LinkedIn", href: "/playbook#fixes", action: "See the rule" } satisfies TriageItem] : []),
      ...[["Issue 40 is out.", "Mon 2 Nov, 08:06"], ["Android Studio now lets you pick from over 40 coding agents.", "Tue 3 Nov, 12:00"]].map(([title, when], i): TriageItem => ({ id: `overdue-${i}`, kind: "overdue", title, detail: `${when} · Company`, href: "https://publish.buffer.com", action: "Open Buffer", full: title, why: "Its time passed while it was a draft, so Buffer did not post it. Pick a new time or delete it in Buffer." }))];
    const shell: ShellAccount = { email: "alex@thisweekinai.example", channels: shellChannels, fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(), needsRefresh: false, name: "Alex Rivera", image: null };
    return <AppShell account={shell} signInOpen><NeedsYouView needs={[]} readiness={[]} greeting="Good evening" triage={triage} /></AppShell>;
  }
  if (screen === "playbook") {
    const shell: ShellAccount = { email: "alex@thisweekinai.example", channels: shellChannels, fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(), needsRefresh: false, name: "Alex Rivera", image: null };
    // ?fixes=reading|offer|none: the same-fix offer at the top, drawn without the server.
    const ending = "Full issue: thisweekin.ai/41";
    const fixes = params.fixes === "offer" ? { ok: true as const, note: "", offers: [{ token: "dev", drafts: 2, rule: `End with "${ending}"`, before: "…ranks #1 on the index, at 59.", after: `…ranks #1 on the index, at 59. ${ending}`, change: { lead: "…ranks #1 on the index, at 59.", removed: "", added: ending, tail: "" }, where: `On Alex Rivera (LinkedIn) you added "${ending}" at the end of 2 drafts, on Tuesday and Thursday.`, why: "Both times the post sends readers to the full issue the same way, so it reads as a habit rather than a one-off." }] }
      : params.fixes === "none" ? { ok: true as const, offers: [], note: "Found 1 repeated fix, but none looked like a lasting preference. One-off facts and chance matches are not offered." }
      : params.fixes === "reading" ? "reading" as const : undefined;
    return <AppShell account={shell} signInOpen><PlaybookView mode="live" initial={fixes ? EXAMPLE_RULES.slice(0, 3) : []} reader={devReadRule} repeats={fixes ? { count: 1, edits: 2 } : undefined} fixesPreview={fixes} /></AppShell>;
  }
  if (screen === "week") {
    // The example week as a signed-in person sees it: the empty slot has an id.
    const week = { ...demoWeek, slotIds: { [slotKey("linkedin", 4, "12:00")]: "dev-linkedin-fri" }, posts: demoWeek.posts.map((p, i) => ({ ...p, createdAt: new Date(Date.now() - (i % 4 + 1) * 86_400_000).toISOString(), createdBy: "Alex Rivera" })) };
    const shell: ShellAccount = { email: "alex@thisweekinai.example", channels: shellChannels, fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(), needsRefresh: false, name: "Alex Rivera", image: null };
    const d1Text = week.posts.find((p) => p.id === "d1")?.text ?? "";
    // ?stale=1: d1 changed since its last check, the state that used to say so three times.
    const staleReason = "The draft or its rules changed. Check it again before approving.";
    const stale = params.stale === "1" ? { readiness: { d1: { state: "check" as const, stale: true, reason: staleReason } }, checkNotes: { d1: staleReason } } : {};
    return <AppShell account={shell} signInOpen><WeekView week={week} live {...stale} verdicts={Object.fromEntries(week.posts.filter((p) => p.ours !== false && p.status === "draft").map((p) => [p.id, p.id === "d1" && params.stale === "1" ? null : p.id === "d1" ? [{ ruleId: "r1", rule: "Name the model and the number in the first line.", level: "block", verdict: "pass", probability: 0.97, quote: "", reason: "" }, { ruleId: "r2", rule: "Mention the issue number.", level: "block", verdict: "pass", probability: 0.95, quote: "", reason: "" }] satisfies Verdict[] : []]))} writing={{ ready: true, source: "built-in AI" }} writeCount={10} evidence={params.video === "1" ? [
      { postId: "d1", snapshotId: "dev-video", sourceKey: "yt:releases-video", title: "This Week in AI video: Terra, Carbon, and 40 agents in Android Studio", uri: "https://www.youtube.com/watch?v=abcdefghijk&list=PLreleases", claim: "This Week in AI 41.", quote: "This Week in AI, issue 41.", locator: null, kind: "transcript", captions: "manual", lastCheckedAt: new Date().toISOString(), needsCheck: false, changed: false, scheduled: false, editable: true, oldText: "", newText: "", draftText: d1Text, why: "" },
      { postId: "d1", snapshotId: "dev-video", sourceKey: "yt:releases-video", title: "This Week in AI video: Terra, Carbon, and 40 agents in Android Studio", uri: "https://www.youtube.com/watch?v=abcdefghijk&list=PLreleases", claim: "For now only a subset of cyber defenders can use it.", quote: "Google is giving Carbon to a subset of cyber defenders first.", locator: "t=1342", kind: "transcript", captions: "auto", lastCheckedAt: new Date().toISOString(), needsCheck: false, changed: false, scheduled: false, editable: true, oldText: "", newText: "", draftText: d1Text, why: "" },
      { postId: "d1", snapshotId: "dev-video", sourceKey: "yt:releases-video", title: "This Week in AI video: Terra, Carbon, and 40 agents in Android Studio", uri: "https://www.youtube.com/watch?v=abcdefghijk&list=PLreleases", claim: "Gemini 4 Carbon ranks #1 on the Artificial Analysis Intelligence Index, at 59.", quote: "Carbon is number one on the Artificial Analysis Intelligence Index, at 59.", locator: "t=754", kind: "transcript", captions: "manual", lastCheckedAt: new Date().toISOString(), needsCheck: false, changed: false, scheduled: false, editable: true, oldText: "", newText: "", draftText: d1Text, why: "" },
    ] : [
      { postId: "d1", snapshotId: "dev-41", sourceKey: "feed:issue-41", title: "This Week in AI 41: Terra, Carbon, and 40 agents in Android Studio", uri: "https://thisweekinai.example/41", claim: "Gemini 4 Carbon ranks #1 on the Artificial Analysis Intelligence Index, at 59.", quote: "Gemini 4 Carbon ranks #1 on the Artificial Analysis Intelligence Index, at 59, by Google's own post.", locator: null, lastCheckedAt: new Date().toISOString(), needsCheck: false, changed: false, scheduled: false, editable: true, oldText: "", newText: "", draftText: "", why: "" },
      { postId: "d1", snapshotId: "dev-41", sourceKey: "feed:issue-41", title: "This Week in AI 41: Terra, Carbon, and 40 agents in Android Studio", uri: "https://thisweekinai.example/41", claim: "This Week in AI 41.", quote: params.problem === "1" ? null : "This Week in AI, issue 41.", locator: null, lastCheckedAt: new Date().toISOString(), needsCheck: false, changed: false, scheduled: false, editable: true, oldText: "", newText: "", draftText: "", why: "" },
    ]} notesPreview={Object.fromEntries(week.posts.map((p) => [p.id, { team: params.team === "1", more: false, notes: params.notes === "0" ? [] : [params.team === "1" ? { id: "n2", author: "Sam Lee", avatar: null, createdAt: new Date(Date.now() - 12 * 60_000).toISOString(), edited: false, text: "Can we use the chart from Sunday instead? This one is hard to read.", canEdit: false, canDelete: false } : { id: "n2", author: "Alex Rivera", avatar: null, createdAt: new Date(Date.now() - 12 * 60_000).toISOString(), edited: false, text: "Add the SEC-bench Pro chart from the Google post before this goes out.", canEdit: true, canDelete: true }, { id: "n1", author: "Alex Rivera", avatar: null, createdAt: "2026-11-03T17:40:00Z", edited: true, text: "Checked the score against the Google post: still 59.", canEdit: true, canDelete: true }] }]))} tagsPreview={Object.fromEntries(week.posts.map((p) => [p.id, params.tags === "0"
      ? { canEdit: p.ours !== false && p.status === "draft", selected: [], all: [] }
      : { canEdit: p.ours !== false && p.status === "draft", selected: [{ id: "t1", name: "Releases", color: "#8F2457" }], all: [{ id: "t1", name: "Releases", color: "#8F2457" }, { id: "t2", name: "Agents", color: "#2F6F4E" }, { id: "t3", name: "Newsletter", color: "#3B5BA5" }] }]))} /></AppShell>;
  }
  const account: ShellAccount = { email: "alex@thisweekinai.example", channels: exampleChannels.slice(0, 3).map(c => ({ ...c, name: c.handle })), fetchedAt: new Date(Date.now() - 3 * 60_000).toISOString(), needsRefresh: false, name: "Alex Rivera", image: null };
  return <AppShell account={account} signInOpen>{screen === "settings" ? <SettingsView account={{ email: "alex@thisweekinai.example", name: "Alex Rivera", image: null, channelNames: ["X", "LinkedIn", "Threads"], rateLimit: [{ policy: "250-in-24h", remaining: 212 }], apps: [{ consentId: "k1", name: "Claude", brand: "Claude", site: "https://claude.ai", approvedAt: "2026-11-02T10:00:00Z", lastUsedAt: "2026-11-02T10:40:00.000Z", calls: 14, label: null, returnsTo: ["claude.ai"], unused: false }, { consentId: "k3", name: "Cursor", brand: "Cursor", site: null, approvedAt: "2026-11-02T21:00:00Z", lastUsedAt: "2026-11-02T10:20:00.000Z", calls: 31, label: "Grok Bot desktop", returnsTo: ["cursor.com", "This computer"], unused: false }, { consentId: "k4", name: "Cursor", brand: "Cursor", site: null, approvedAt: "2026-11-01T09:00:00Z", lastUsedAt: "2026-11-01T09:30:00.000Z", calls: 6, label: null, returnsTo: ["cursor.com"], unused: false }, { consentId: "k5", name: "Grok", brand: "Grok", site: null, approvedAt: "2026-11-01T08:00:00Z", lastUsedAt: "2026-11-02T03:00:00.000Z", calls: 9, label: null, returnsTo: ["grok.com"], unused: false }, { consentId: "k2", name: "ChatGPT", brand: "ChatGPT", site: null, approvedAt: "2026-09-30T10:00:00Z", lastUsedAt: null, calls: 0, label: null, returnsTo: ["chatgpt.com"], unused: true }], devices: [{ id: "s1", device: "Chrome on Mac", lastActive: "2026-11-03T12:00:00Z", current: true }, { id: "s2", device: "Safari on iPhone", lastActive: "2026-11-02T08:14:00Z", current: false }] }} /> : screen === "voice" ? <VoiceView
        mode="live"
        note="Short, plain, no emojis. One link at the end."
        examples={[{ postId: "p1", channel: "X", text: "Kimi K3.1 Pro has a 1-million-token context window, and Moonshot calls it its most capable 3T-class open-weights model." }]}
        candidates={[
          { postId: "p1", channel: "X", text: "Kimi K3.1 Pro has a 1-million-token context window, and Moonshot calls it its most capable 3T-class open-weights model." },
          { postId: "p2", channel: "LinkedIn", text: "We rebuilt export this month. Here is what we learned from 40 support tickets about CSV files, and the three changes that came out of them." },
          { postId: "p3", channel: "Threads", text: "New on the blog: why we stopped sending weekly digests nobody opened." },
        ]}
      /> : <BriefingView mode="live" ideasPreview={[{ organizationId: "org", more: false, columns: [
        { id: "unassigned", name: "Unassigned", ideas: [{ id: "i1", title: "Video: what NVIDIA's new Vera numbers mean for agents", text: "New video. No open time left this week, so it waits here." }, { id: "i2", title: null, text: "Ask readers which of the 40 agents in Android Studio they picked, and share the top three." }] },
        { id: "todo", name: "To Do", ideas: [{ id: "i3", title: "This Week in AI 42: Kimi K3.1 Pro weights, NVIDIA Vera", text: "Lands Sunday. Draft LinkedIn and X posts for the week after." }] },
        { id: "doing", name: "In Progress", ideas: [] },
        { id: "done", name: "Done", ideas: [{ id: "i4", title: "Issue 40: Claude Duet, Kimi K3.1 Pro", text: "Posted on LinkedIn and Instagram." }] },
      ] }]} />}</AppShell>;
}
