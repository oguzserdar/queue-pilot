"use client";

import { useRouter } from "next/navigation";
import { UserMenu } from "@/registry/components/user-menu/user-menu";

/**
 * Bottom-left account menu: the person's Buffer picture, name and email, opening to their settings and sign out.
 * Shaped after the sidebar account menu in our Next.js reference app (avatar, name over email, a short menu, sign out
 * that also clears browser-held data). No keyboard shortcuts are listed because none are wired.
 */
export function AccountMenu({ name, email, image, isAdmin }: { name: string; email: string; image: string | null; isAdmin?: boolean }) {
  const router = useRouter();
  const signOut = async () => {
    // Only clear and leave once the server confirms; otherwise the person would believe they are signed out.
    const res = await fetch("/auth/signout", { method: "POST" }).catch(() => null);
    if (!res?.ok) {
      window.alert("Queue Pilot could not sign you out just now. Check your connection and try again.");
      return;
    }
    // Nothing of this person's should outlive the session in this browser; device choices are kept.
    try {
      const keep = ["theme", "cookie_consent"].map((k) => [k, localStorage.getItem(k)] as const);
      localStorage.clear();
      sessionStorage.clear();
      for (const [k, v] of keep) if (v !== null) localStorage.setItem(k, v);
    } catch {
      // Storage can be unavailable (private windows); the server session is already gone.
    }
    window.location.assign("/");
  };
  return (
    <UserMenu
      // The admin of this copy sees it under their name, the way a plan name shows, and gets the admin settings in the menu.
      user={{ name, email, avatarSrc: image ?? undefined, plan: isAdmin ? "Admin" : undefined }}
      showName
      showTheme={false}
      align="start"
      block
      items={[
        { label: "Settings", onSelect: () => router.push("/settings") },
        { label: "Connect your AI", onSelect: () => router.push("/connect") },
        { label: "Sources", onSelect: () => router.push("/sources") },
        ...(isAdmin ? [{ label: "Admin settings", onSelect: () => router.push("/admin") }] : []),
      ]}
      onSignOut={signOut}
    />
  );
}
