"use client";

import Link from "next/link";
import { useEffect, useState, type ComponentType } from "react";
import { BottomSheet } from "@/registry/components/bottom-sheet/bottom-sheet";
import styles from "./tab-bar.module.css";

type Item = { href: string; label: string; Icon: ComponentType<{ size?: number; className?: string }> };

/**
 * The phone navigation: the first group's pages as fixed tabs, everything else in a More sheet with the sidebar's
 * own headings. Tabs never scroll, and More shows as current when the open page lives inside it.
 */
export function TabBar({ tabs, more, isActive, badge }: {
  tabs: Item[];
  more: { label: string | null; items: Item[] }[];
  isActive: (href: string) => boolean;
  /** A count on the first tab, such as the things that need you. */
  badge?: number;
}) {
  const [open, setOpen] = useState(false);
  const inMore = more.some(g => g.items.some(i => isActive(i.href)));
  // Picking a page closes the sheet; so does any route change from elsewhere.
  const current = more.flatMap(g => g.items).find(i => isActive(i.href))?.href;
  useEffect(() => setOpen(false), [current]);
  return (
    <nav className={styles.bar} aria-label="Main">
      {tabs.map(({ href, label, Icon }, i) => {
        const on = isActive(href);
        return (
          <Link key={href} href={href} className={styles.tab} aria-current={on ? "page" : undefined}>
            <span className={styles.icon}><Icon size={24} />{i === 0 && badge ? <span className={styles.badge}>{badge}</span> : null}</span>
            <span className={styles.label}>{label}</span>
          </Link>
        );
      })}
      <BottomSheet
        open={open}
        onOpenChange={setOpen}
        title="More"
        detents={[0.62]}
        trigger={
          <button type="button" className={styles.tab} aria-current={inMore ? "page" : undefined}>
            <span className={styles.icon}><MoreIcon /></span>
            <span className={styles.label}>More</span>
          </button>
        }
      >
        <div className={styles.sheet}>
          {more.map(g => (
            <div key={g.label ?? "more"} className={styles.group}>
              {g.label && <span className={styles.groupLabel}>{g.label}</span>}
              {g.items.map(({ href, label, Icon }) => {
                const on = isActive(href);
                return (
                  <Link key={href} href={href} className={styles.row} aria-current={on ? "page" : undefined} onClick={() => setOpen(false)}>
                    <Icon size={20} className={styles.rowIcon} />{label}
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </BottomSheet>
    </nav>
  );
}

function MoreIcon() {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="5" cy="12" r="1.2" /><circle cx="12" cy="12" r="1.2" /><circle cx="19" cy="12" r="1.2" /></svg>;
}
