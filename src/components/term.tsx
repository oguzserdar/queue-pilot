"use client";

import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/registry/components/popover/popover";
import styles from "./term.module.css";

/**
 * A plain word on the screen that opens the precise term behind it. The surface stays easy to read; anyone who knows
 * the jargon, or meets it in their AI app's settings, can still find the exact word.
 */
export function Term({ children, term, note }: {
  /** What the screen says. */
  children: ReactNode;
  /** The precise or product term it stands for. */
  term: string;
  /** One or two sentences on what it means here. */
  note: string;
}) {
  return (
    <Popover>
      <PopoverTrigger className={styles.trigger}>{children}</PopoverTrigger>
      <PopoverContent className={styles.panel}>
        <p className={styles.term}>{term}</p>
        <p className={styles.note}>{note}</p>
      </PopoverContent>
    </Popover>
  );
}
