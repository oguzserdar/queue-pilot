"use client";

import { BUFFER_CHANNELS_URL } from "@/lib/connect-links";
import Link from "next/link";

import { SignInButton } from "./sign-in-button";

import { MotionConfig } from "motion/react";
import { usePathname } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { AccountMenu } from "./account-menu";
import { BufferSyncProvider, SyncBanner, SyncIndicator, type SyncStatus } from "./buffer-sync";
import { BookTextIcon } from "./animated-icons/book-text";
import { CalendarDaysIcon } from "./animated-icons/calendar-days";
import { CheckCheckIcon } from "./animated-icons/check-check";
import { FeatherIcon } from "./animated-icons/feather";
import { LinkIcon } from "./animated-icons/link";
import { PlugZapIcon } from "./animated-icons/plug-zap";
import { SettingsIcon } from "./animated-icons/settings";
import { ShieldCheckIcon } from "./animated-icons/shield-check";
import { SparklesIcon } from "./animated-icons/sparkles";
import { ToastStack, ToastStackProvider } from "@/registry/components/toast-stack/toast-stack";
import { KeyboardShortcuts } from "./keyboard-shortcuts";
import { NavItem } from "./nav-item";
import styles from "./app-shell.module.css";

/** Sidebar sections, grouped by what the person is doing: planning, learning, connecting, settings. */
const NAV_GROUPS = [
  { label: null, items: [
    { href: "/", label: "Needs you", Icon: CheckCheckIcon },
    { href: "/week", label: "Next week", Icon: CalendarDaysIcon },
    { href: "/delivery", label: "Delivery", Icon: ShieldCheckIcon },
  ] },
  { label: "What it knows", items: [
    { href: "/playbook", label: "Playbook", Icon: BookTextIcon },
    { href: "/voice", label: "Voice", Icon: FeatherIcon },
    { href: "/ideas", label: "New material", Icon: SparklesIcon },
    { href: "/sources", label: "Sources", Icon: LinkIcon },
  ] },
  { label: "Setup", items: [
    { href: "/connect", label: "Connect your AI", Icon: PlugZapIcon },
    { href: "/settings", label: "Settings", Icon: SettingsIcon },
  ] },
];

/** The signed-in account the frame shows; null for the example account. */
export type ShellAccount = {
  email: string;
  channelCount: number;
  fetchedAt: string;
  needsRefresh: boolean;
  /** Name and picture from the person's Buffer account, for the account menu. */
  name: string;
  image: string | null;
  /** True for this copy's admin, who sees "Admin" under their name and the admin settings in the menu. */
  isAdmin?: boolean;
  /** Development states page only. */
  syncPreview?: SyncStatus;
} | null;

/** Sync state exists only for a signed-in account; example data has nothing to sync. */
function MaybeSync({ account, children }: { account: ShellAccount; children: ReactNode }) {
  return account ? <BufferSyncProvider fetchedAt={account.fetchedAt} needsRefresh={account.needsRefresh} preview={account.syncPreview}>{children}</BufferSyncProvider> : <>{children}</>;
}

/** The app frame: sidebar navigation, the user's AI, and the Buffer account. Signed out, every screen shows example data and says so. */
export function AppShell({ account, signInOpen, children }: { account: ShellAccount; signInOpen: boolean; children: ReactNode }) {
  const path = usePathname();
  const navRef = useRef<HTMLElement>(null);
  // On a phone the tab row scrolls sideways: bring the current page's tab into view, so you can see where you are.
  useEffect(() => {
    navRef.current?.querySelector<HTMLElement>('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [path]);
  return (
    <MotionConfig reducedMotion="user">
    <ToastStackProvider>
    <KeyboardShortcuts />
    <MaybeSync account={account}>
    <div className={styles.frame}>
        <aside className={styles.side}>
          <Link href="/" className={styles.brand} aria-label="Queue Pilot home">Queue Pilot<span className={styles.brandDot} aria-hidden="true">.</span></Link>
          <nav ref={navRef} className={styles.nav} aria-label="Main">
            {NAV_GROUPS.map((group) => (
              <div key={group.label ?? "home"} className={styles.group}>
                {group.label && <span className={styles.groupLabel}>{group.label}</span>}
                {group.items.map(({ href, label, Icon }) => {
                  const active = href === "/" ? path === "/" : path.startsWith(href);
                  return <NavItem key={href} href={href} label={label} Icon={Icon} active={active} className={active ? `${styles.link} ${styles.active}` : styles.link} iconClassName={styles.navIcon} pendingClassName={styles.pending} />;
                })}
              </div>
            ))}
          </nav>
          <div className={styles.account}>
            {account ? (
              <>
                <div className={`${styles.syncRow} ${styles.statusCard}`}>
                  {account.channelCount === 0
                    ? <span className={styles.statusLine}>No channels in Buffer <a className={styles.statusLink} href={BUFFER_CHANNELS_URL} target="_blank" rel="noreferrer">Add</a></span>
                    : <span className={styles.statusLine}>{account.channelCount} channel{account.channelCount === 1 ? "" : "s"} in Buffer</span>}
                  <SyncIndicator />
                </div>
                <div className={styles.menuRow}><AccountMenu name={account.name} email={account.email} image={account.image} isAdmin={account.isAdmin} /></div>
              </>
            ) : (
              <>
                {/* The same status card as a signed-in account, describing the example one. */}
                <div className={`${styles.syncRow} ${styles.statusCard}`}>
                  <span className={styles.statusLine}>4 channels in Buffer</span>
                  <span className={styles.statusNote}>Example account: Mark Evans</span>
                </div>
                {signInOpen ? <SignInButton variant="primary" size="md" className={styles.signIn} /> : <span className={`${styles.aiNote} ${styles.who}`}>Sign in with Buffer opens shortly.</span>}
              </>
            )}
          </div>
        </aside>
        <div className={styles.column}>
          {account ? <SyncBanner /> : (
            <div className={styles.demo}>Example account: Mark writes Weeknight Dinners, a cooking newsletter. Sign in with Buffer to see your own queue.</div>
          )}
          <main className={styles.main}>{children}</main>
        </div>
    </div>
    </MaybeSync>
    {/* Confirms a change after it happens; errors stay next to the button that caused them. */}
    <ToastStack />
    </ToastStackProvider>
    </MotionConfig>
  );
}
