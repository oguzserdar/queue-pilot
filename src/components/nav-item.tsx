"use client";

import Link, { useLinkStatus } from "next/link";
import { useRef, type ComponentType, type RefAttributes } from "react";

/** Every vendored animated icon exposes this handle. */
type IconHandle = { startAnimation: () => void; stopAnimation: () => void };
type AnimatedIcon = ComponentType<{ size?: number; className?: string } & RefAttributes<IconHandle>>;

/** A sidebar link whose icon plays when the whole row is hovered or focused, not only the icon itself. */
export function NavItem({ href, label, Icon, active, className, iconClassName, pendingClassName }: {
  href: string;
  label: string;
  Icon: AnimatedIcon;
  active: boolean;
  className: string;
  iconClassName: string;
  /** Drawn behind the row while its page loads, so a click shows at once. */
  pendingClassName: string;
}) {
  const icon = useRef<IconHandle>(null);
  return (
    <Link
      href={href}
      className={className}
      aria-current={active ? "page" : undefined}
      // Hover only: keyboard focus moves through these rows many times a day, and motion there just slows the eye.
      onMouseEnter={() => icon.current?.startAnimation()}
      onMouseLeave={() => icon.current?.stopAnimation()}
    >
      <Pending className={pendingClassName} />
      <Icon ref={icon} size={16} className={iconClassName} aria-hidden="true" />
      {label}
    </Link>
  );
}

/**
 * The clicked row's pending state. Pages are rendered per person, so a click waits for the server; this marks the row
 * at once instead of a page-wide skeleton, which would keep the new page back for its own minimum display time.
 */
function Pending({ className }: { className: string }) {
  const { pending } = useLinkStatus();
  return <span className={className} data-pending={pending || undefined} aria-hidden="true" />;
}
