"use client";

/**
 * What one posting time on the week shows: a draft being written by a fill, a time that has passed, an empty time to
 * write into, a post that left the drafts, or a draft card that opens its window. Shared by the desktop grid and the
 * phone day list (src/components/week-view.tsx).
 */
import type { EvidenceCard } from "@/lib/source-presentation";
import { postState } from "@/lib/post-state";
import { worstTone, type WeekPost } from "@/lib/week-model";
import { StateMark } from "./state-mark";
import { SOURCE_SHORT } from "./week-draft-window";
import styles from "./week-view.module.css";

/** A time a fill is writing into: "Writing" until its draft arrives, then the draft's text. */
export function WritingCell({ time, name, text }: { time: string; name: string; text: string | undefined }) {
  return (
    <div className={styles.writing} data-written={text !== undefined} aria-label={`${name}: ${text === undefined ? "a draft is being written" : "draft written"}`}>
      <span className={styles.writingHead}><span>{time}</span><span aria-hidden="true">{text === undefined ? "Writing" : "Written"}</span></span>
      {text !== undefined && <span className={styles.writingText}>{text}</span>}
    </div>
  );
}

/** A posting time that has passed: nothing can be written into it now. */
export function PassedCell({ time, name }: { time: string; name: string }) {
  return <div className={styles.passed} aria-label={`${name}: this time has passed`}><span>{time}</span><span aria-hidden="true">Passed</span></div>;
}

/** An empty posting time: pressing it opens the composer for that channel and time. */
export function EmptyCell({ time, name, onWrite }: { time: string; name: string; onWrite: () => void }) {
  return (
    <button type="button" className={styles.empty} aria-label={`Write a post for ${name}`} onClick={onWrite}>
      <span>{time}</span>
      <span className={styles.addCue} aria-hidden="true">+ Add</span>
    </button>
  );
}

/** A post that is no longer a draft: scheduled, sent, or failed with Buffer's reason, and who approved it. */
export function PostedCell({ time, post: p, approval }: { time: string; post: WeekPost; approval: string | undefined }) {
  return (
    <div className={styles.existing} data-status={p.status}>
      <span className={styles.time}>{time}<span className={styles.state}><StateMark state={postState(p)} word /></span></span>
      <span className={styles.text}>{p.text}</span>
      {p.status === "error" && <span className={styles.reason}>{p.error?.message || "Buffer did not say why."} This time counts as open again.</span>}
      {approval && <span className={styles.ruleWhy}>{approval}</span>}
    </div>
  );
}

/** Where a draft card says it came from: the checked source, the kind of source, or Buffer. */
function sourceTitle(p: WeekPost, citation: EvidenceCard | undefined): string {
  if (citation) return `${citation.title} · ${citation.needsCheck ? "Evidence needs review" : "Quote matches saved source"}`;
  return p.source?.label ?? "Draft saved in Buffer";
}

/** The short source line on a draft card. */
function sourceShort(p: WeekPost, citation: EvidenceCard | undefined): string {
  if (citation) return citation.title;
  return p.source ? SOURCE_SHORT[p.source.kind] : "Buffer draft";
}

/** A draft card: its state, its text, whether it is overdue, and where it came from. Pressing it opens its window. */
export function DraftCell({ time, post: p, citation, approved, selected, overdue, onOpen }: { time: string; post: WeekPost; citation: EvidenceCard | undefined; approved: boolean; selected: boolean; overdue: boolean; onOpen: (button: HTMLButtonElement) => void }) {
  return (
    <button type="button" onClick={(e) => onOpen(e.currentTarget)} className={styles.draft} data-tone={worstTone(p)} data-selected={selected} data-approved={approved}>
      <span className={styles.time}>{time}<span className={styles.state}><StateMark state={postState(p, approved)} word why={p.checks?.find((c) => c.tone === "danger")?.label} /></span></span>
      <span className={styles.text}>{p.text}</span>
      {overdue && <span className={styles.reason}>Overdue: its time passed, so Buffer will not post it. Pick a new time in Buffer.</span>}
      <span className={styles.src} title={sourceTitle(p, citation)}>{sourceShort(p, citation)}</span>
    </button>
  );
}
