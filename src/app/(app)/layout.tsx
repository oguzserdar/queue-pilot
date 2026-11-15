import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { BufferUnreadable } from "@/components/buffer-unreadable";
import { getSessionCookie } from "better-auth/cookies";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getCurrentUser, signedInProfile, signedInUserId } from "@/lib/current-user";
import { getAuth } from "@/lib/auth";
import { listSocialAccounts } from "@/lib/social-accounts";
import { readOr } from "@/lib/read-or";

export const dynamic = "force-dynamic";
// Writing a week runs AI calls of up to a couple of minutes inside a server action on these pages.
export const maxDuration = 300;

export default async function AppLayout({ children }: { children: ReactNode }) {
  const [{ user, signInOpen, unreadable }, profile] = await Promise.all([getCurrentUser(), signedInProfile()]);
  // Signed in, but no Buffer data to show: say so. The example account is for signed-out visitors only.
  if (unreadable) return <BufferUnreadable retryAt={unreadable.retryAt} />;
  // A sign-in cookie with no session behind it (account deleted, session expired, signed out elsewhere) would show an
  // empty app where the homepage belongs. Clear it and go home. Only when sign-in is set up: without it, the expired
  // page cannot check the session and sends the visitor straight back, a redirect loop.
  if (!user && process.env.LANDING_PAGE === "on" && getSessionCookie(await headers()) && (await getAuth()) && !(await signedInUserId())) redirect("/auth/expired");
  // Without Buffer, the sidebar names the accounts Queue Pilot posts to itself.
  const userId = user?.noBuffer ? await signedInUserId() : null;
  const direct = userId ? await readOr(listSocialAccounts(userId), [], "shell-direct-accounts") : [];
  return (
    <AppShell account={user ? { email: user.email, noBuffer: user.noBuffer, channels: user.noBuffer ? direct.map((a) => ({ id: a.id, name: a.handle, service: a.network })) : user.channels.map(({ id, name, service }) => ({ id, name, service })), fetchedAt: user.fetchedAt.toISOString(), needsRefresh: user.needsRefresh, name: profile?.name ?? user.email, image: profile?.image ?? null, isAdmin: profile?.isAdmin } : null} signInOpen={signInOpen} landing={process.env.LANDING_PAGE === "on"}>
      {children}
    </AppShell>
  );
}
