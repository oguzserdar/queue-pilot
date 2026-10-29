import { VoiceView } from "@/components/voice-view";
import { getCurrentUser, signedInUserId } from "@/lib/current-user";
import { postgresVoiceStore } from "@/lib/voice-store";

export default async function Page() {
  const { user } = await getCurrentUser();
  if (!user) return <VoiceView mode="example" />;
  const userId = await signedInUserId();
  const voice = userId ? await postgresVoiceStore().get(userId) : { examples: [], note: null };
  const names = new Map(user.channels.map((c) => [c.id, c.name]));
  // Recent sent posts from the saved copy of the queue, newest first: the ones the user can pick as examples.
  const candidates = user.posts
    .filter((p) => p.status === "sent" && p.text.trim())
    .sort((a, b) => (b.sentAt ?? "").localeCompare(a.sentAt ?? ""))
    .slice(0, 30)
    .map((p) => ({ postId: p.id, channel: names.get(p.channelId) ?? "Buffer", text: p.text }));
  return <VoiceView mode="live" candidates={candidates} examples={voice.examples} note={voice.note} />;
}
