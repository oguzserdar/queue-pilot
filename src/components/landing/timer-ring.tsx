import type { CSSProperties } from "react";
import styles from "./timer-ring.module.css";

/**
 * A small round timer: the ring fills once over `ms`, and when it closes the next step comes. It restarts whenever its
 * `key` changes, and holds still while `paused`. It fills at a steady rate (linear), because it stands for time.
 */
export function TimerRing({ ms, paused = false, tone = "light", className }: { ms: number; paused?: boolean; tone?: "light" | "dark"; className?: string }) {
  const style: CSSProperties & { "--ms": string } = { "--ms": `${ms}ms` };
  return (
    <svg className={[styles.ring, className].filter(Boolean).join(" ")} data-tone={tone} data-paused={paused || undefined} viewBox="0 0 20 20" aria-hidden="true"
      style={style}>
      <circle className={styles.track} cx="10" cy="10" r="7" />
      <circle className={styles.fill} cx="10" cy="10" r="7" pathLength="100" />
    </svg>
  );
}
