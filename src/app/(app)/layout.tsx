import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { getCurrentUser, signedInProfile } from "@/lib/current-user";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const [{ user, signInOpen }, profile] = await Promise.all([getCurrentUser(), signedInProfile()]);
  return (
    <AppShell account={user ? { email: user.email, channels: user.channels.map(({ id, name, service }) => ({ id, name, service })), fetchedAt: user.fetchedAt.toISOString(), needsRefresh: user.needsRefresh, name: profile?.name ?? user.email, image: profile?.image ?? null, isAdmin: profile?.isAdmin } : null} signInOpen={signInOpen}>
      {children}
    </AppShell>
  );
}
