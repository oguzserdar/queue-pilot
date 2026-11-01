"use client";

import styles from "./rolling-number.module.css";

/**
 * A count that rolls to its new value: the new digits rise into place instead of the number jumping. Keyed by value,
 * so each change starts from below; reduced motion shows the number at once.
 */
export function RollingNumber({ value }: { value: number }) {
  return <span className={styles.roll}><span key={value} className={styles.digits}>{value}</span></span>;
}
