/** Development only: the draft follow-up panel with sample places, a waiting follow-up and one already sent. */
import { notFound } from "next/navigation";
import { FollowUpPanel } from "@/components/follow-up-panel";
import { ToastStack, ToastStackProvider } from "@/registry/components/toast-stack/toast-stack";

const TEXT = "This Week in AI 41 is out: GPT-6.1 Terra, Gemini 4 Carbon, and over 40 coding agents in Android Studio.";

async function targets() {
  "use server";
  if (process.env.NODE_ENV === "production") throw new Error("Not available.");
  return {
    telegram: { label: "This Week in AI", limit: 4096 },
    discord: { label: "This Week in AI", limit: 2000, defaultId: "c1", channels: [{ id: "c1", name: "new-issues", canPost: true }, { id: "c2", name: "general", canPost: true }] },
  };
}
async function followUp(id: string) {
  "use server";
  if (process.env.NODE_ENV === "production") throw new Error("Not available.");
  const due = "2026-11-09T14:00:00.000Z"; // Mon 9 Nov, 09:00 in Toronto, Alex's time zone
  if (id === "sent") return { dueAt: due, places: [{ kind: "telegram" as const, label: "This Week in AI", text: TEXT, target: "-100", status: "sent" as const, error: null, link: "https://t.me/qp/7" }, { kind: "discord" as const, label: "This Week in AI #new-issues", text: TEXT, target: "c1", status: "failed" as const, error: "The post was deleted in Buffer, so this was not sent.", link: null }] };
  if (id === "waiting") return { dueAt: due, places: [{ kind: "discord" as const, label: "This Week in AI #new-issues", text: "Issue 41 is up. Which of the three did you try this week? Tell us in #general.", target: "c1", status: "scheduled" as const, error: null, link: null }] };
  return { dueAt: due, places: [] };
}
async function save() {
  "use server";
  if (process.env.NODE_ENV === "production") throw new Error("Not available.");
  return { ok: true as const, places: [] };
}

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <ToastStackProvider>
      <main style={{ maxWidth: 760, margin: "32px auto", display: "flex", flexDirection: "column", gap: 24, padding: "0 16px" }}>
        <FollowUpPanel bufferPostId="new" draftText={TEXT} loaders={{ targets, followUp, save }} />
        <FollowUpPanel bufferPostId="waiting" draftText={TEXT} loaders={{ targets, followUp, save }} />
        <FollowUpPanel bufferPostId="sent" draftText={TEXT} loaders={{ targets, followUp, save }} />
      </main>
      <ToastStack />
    </ToastStackProvider>
  );
}
