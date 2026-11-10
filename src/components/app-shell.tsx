"use client";

import { BUFFER_CHANNELS_URL } from "@/lib/connect-links";
import Link from "next/link";

import { SignInButton, SignInNotice } from "./sign-in-button";
import button from "@/registry/components/button/button.module.css";
import { DemoNudge } from "./demo-nudge";

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
import { MessageSquareMoreIcon } from "./animated-icons/message-square-more";
import { ShieldCheckIcon } from "./animated-icons/shield-check";
import { SparklesIcon } from "./animated-icons/sparkles";
import { ToastStack, ToastStackProvider } from "@/registry/components/toast-stack/toast-stack";
import { KeyboardShortcuts } from "./keyboard-shortcuts";
import { NavItem } from "./nav-item";
import { TabBar } from "./tab-bar";
import styles from "./app-shell.module.css";
import { ChannelIcon } from "./channel-icon";
import { channels as exampleChannels } from "@/lib/example-channels";

/** Sidebar sections, grouped by what the person is doing: planning, learning, connecting, settings. */
const NAV_GROUPS = [
  { label: null, items: [
    { href: "/", label: "Needs you", Icon: CheckCheckIcon },
    { href: "/week", label: "Next week", Icon: CalendarDaysIcon },
    { href: "/reviews", label: "Reviews", Icon: MessageSquareMoreIcon },
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
  channels: { id: string; name: string; service: string }[];
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

/** The same compact channel identity for real and example accounts. */
function ChannelStatus({ channels }: { channels: NonNullable<ShellAccount>["channels"] }) {
  if (!channels.length) return <span className={styles.statusLine}>No channels in Buffer <a className={styles.statusLink} href={BUFFER_CHANNELS_URL} target="_blank" rel="noreferrer">Add</a></span>;
  const names = channels.map(c => `${c.name} (${c.service})`).join(", ");
  return <Link href="/settings?tab=channels" className={styles.channelStatus} title={names} aria-label={`Buffer channels: ${names}`}>
    {channels.length <= 2 ? channels.map(c => <span key={c.id} className={styles.channelName}><ChannelIcon service={c.service} /><span>{c.name}</span></span>) :
      <span className={styles.channelSummary}><span className={styles.channelLogos} aria-hidden="true">{channels.slice(0, 4).map(c => <span key={c.id}><ChannelIcon service={c.service} size={14} /></span>)}</span><span>{channels.length} channels</span></span>}
  </Link>;
}

/** Sync state exists only for a signed-in account; example data has nothing to sync. */
function MaybeSync({ account, children }: { account: ShellAccount; children: ReactNode }) {
  return account ? <BufferSyncProvider fetchedAt={account.fetchedAt} needsRefresh={account.needsRefresh} preview={account.syncPreview}>{children}</BufferSyncProvider> : <>{children}</>;
}

/** The app frame: sidebar navigation, the user's AI, and the Buffer account. Signed out, every screen shows example data and says so. */
export function AppShell({ account, signInOpen, landing = true, children }: { account: ShellAccount; signInOpen: boolean; /** Whether the homepage is launched. Before that there is no demo address to enter or leave: the example is simply what a signed-out visitor sees. */ landing?: boolean; children: ReactNode }) {
  const path = usePathname();
  // The demo's home lives at /demo, because / is the homepage for anyone not signed in.
  const home = account || !landing ? "/" : "/demo";
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
          <Link href={home} className={styles.brand} aria-label="Queue Pilot home">Queue Pilot<span className={styles.brandDot} aria-hidden="true">.</span></Link>
          <nav ref={navRef} className={styles.nav} aria-label="Main">
            {NAV_GROUPS.map((group) => (
              <div key={group.label ?? "home"} className={styles.group}>
                {group.label && <span className={styles.groupLabel}>{group.label}</span>}
                {group.items.map(({ href: to, label, Icon }) => {
                  const href = to === "/" ? home : to;
                  const active = to === "/" ? path === "/" || path === "/demo" : path.startsWith(href);
                  return <NavItem key={href} href={href} label={label} Icon={Icon} active={active} className={active ? `${styles.link} ${styles.active}` : styles.link} iconClassName={styles.navIcon} pendingClassName={styles.pending} />;
                })}
              </div>
            ))}
          </nav>
          <div className={styles.account}>
            {account ? (
              <>
                <div className={`${styles.syncRow} ${styles.statusCard}`}>
                  <ChannelStatus channels={account.channels} />
                  <SyncIndicator />
                </div>
                <div className={styles.menuRow}><AccountMenu name={account.name} email={account.email} image={account.image} isAdmin={account.isAdmin} /></div>
              </>
            ) : (
              <>
                {/* The same status card as a signed-in account, describing the example one. */}
                <div className={`${styles.syncRow} ${styles.statusCard}`}>
                  <ChannelStatus channels={exampleChannels.map(c => ({ ...c, name: c.handle }))} />
                  <span className={styles.statusNote}>Demo account: Alex Rivera</span>
                </div>
                {signInOpen ? <SignInButton variant="primary" size="md" className={styles.signIn} /> : <span className={`${styles.aiNote} ${styles.who}`}>Sign in with Buffer opens shortly.</span>}
              </>
            )}
          </div>
        </aside>
        <div className={styles.column}>
          {account ? <SyncBanner /> : (
            // The demo bar says where you are and always offers the way out, as a button, not a link at the end of a sentence.
            <div className={styles.demo}>
              <p className={styles.demoText}><b>Demo</b> Alex Rivera&apos;s sample account: the app itself, with sample data. Nothing here touches a real Buffer.</p>
              {landing && <a className={[button.button, button.secondary, button.sm, styles.demoExit].join(" ")} href="/demo/leave">Exit demo</a>}
            </div>
          )}
          <main className={styles.main}><SignInNotice />{children}</main>
        </div>
      <TabBar
        tabs={NAV_GROUPS[0].items.map(i => ({ ...i, href: i.href === "/" ? home : i.href }))}
        more={NAV_GROUPS.slice(1)}
        isActive={(href) => href === home ? path === "/" || path === "/demo" : path.startsWith(href)}
      />
    </div>
    </MaybeSync>
    {/* Confirms a change after it happens; errors stay next to the button that caused them. */}
    <ToastStack />
    {/* The demo only: after a few clicks, ask the visitor to try it on their own Buffer. */}
    {!account ? <DemoNudge /> : null}
    </ToastStackProvider>
    </MotionConfig>
  );
}
