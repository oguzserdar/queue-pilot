/** Development only: the draft follow-up panel with sample places, a waiting follow-up and one already sent. */
import { notFound } from "next/navigation";
import { FollowUpPanel } from "@/components/follow-up-panel";
import { ToastStack, ToastStackProvider } from "@/registry/components/toast-stack/toast-stack";

const TEXT = "Three model releases this week, and what changed for people building with them. The full issue is out now.";

async function targets() {
  "use server";
  return {
    telegram: { label: "QueuePilot", limit: 4096 },
    discord: { label: "QP test", limit: 2000, defaultId: "c1", channels: [{ id: "c1", name: "announcements", canPost: true }, { id: "c2", name: "general", canPost: true }] },
  };
}
async function followUp(id: string) {
  "use server";
  const due = new Date(Date.now() + 5 * 3_600_000).toISOString();
  if (id === "sent") return { dueAt: due, places: [{ kind: "telegram" as const, label: "QueuePilot", text: TEXT, target: "-100", status: "sent" as const, error: null, link: "https://t.me/qp/7" }, { kind: "discord" as const, label: "QP test #announcements", text: TEXT, target: "c1", status: "failed" as const, error: "The post was deleted in Buffer, so this was not sent.", link: null }] };
  if (id === "waiting") return { dueAt: due, places: [{ kind: "discord" as const, label: "QP test #announcements", text: "New issue is out: three model releases, explained.", target: "c1", status: "scheduled" as const, error: null, link: null }] };
  return { dueAt: due, places: [] };
}
async function save() {
  "use server";
  return { ok: true as const };
}

export default function Page() {
  if (process.env.NODE_ENV === "production") notFound();
  return (
    <ToastStackProvider>
      <main style={{ maxWidth: 560, margin: "32px auto", display: "flex", flexDirection: "column", gap: 24, padding: "0 16px" }}>
        <FollowUpPanel bufferPostId="new" draftText={TEXT} loaders={{ targets, followUp, save }} />
        <FollowUpPanel bufferPostId="waiting" draftText={TEXT} loaders={{ targets, followUp, save }} />
        <FollowUpPanel bufferPostId="sent" draftText={TEXT} loaders={{ targets, followUp, save }} />
      </main>
      <ToastStack />
    </ToastStackProvider>
  );
}
