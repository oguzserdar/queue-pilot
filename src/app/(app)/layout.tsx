import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { BufferUnreadable } from "@/components/buffer-unreadable";
import { getCurrentUser, signedInProfile } from "@/lib/current-user";

export const dynamic = "force-dynamic";
// Writing a week runs AI calls of up to a couple of minutes inside a server action on these pages.
export const maxDuration = 300;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const [{ user, signInOpen, unreadable }, profile] = await Promise.all([getCurrentUser(), signedInProfile()]);
  // Signed in, but no Buffer data to show: say so. The example account is for signed-out visitors only.
  if (unreadable) return <BufferUnreadable retryAt={unreadable.retryAt} />;
  return (
    <AppShell account={user ? { email: user.email, channels: user.channels.map(({ id, name, service }) => ({ id, name, service })), fetchedAt: user.fetchedAt.toISOString(), needsRefresh: user.needsRefresh, name: profile?.name ?? user.email, image: profile?.image ?? null, isAdmin: profile?.isAdmin } : null} signInOpen={signInOpen} landing={process.env.LANDING_PAGE === "on"}>
      {children}
    </AppShell>
  );
}
