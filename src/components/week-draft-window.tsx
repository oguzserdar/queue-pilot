"use client";

/**
 * The draft window on the week: a draft opens in a dialog over the week, the way a calendar opens an event. The post
 * (or its editor) and its sources on one side, its checks, notes and follow-up on the other, and the decision in a
 * fixed bar at the bottom. The week (src/components/week-view.tsx) works out what each draft's window shows.
 */
import type { RefObject } from "react";
import { CircleCheck, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu } from "@/registry/components/dropdown-menu/dropdown-menu";
import { Textarea } from "@/registry/components/textarea/textarea";
import { Button } from "@/registry/components/button/button";
import { Badge } from "@/registry/components/badge/badge";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { rulesForAccount } from "@/lib/rule-explain";
import { APPROVED_IN_APP, approverLine } from "@/lib/rule-origin";
import type { Readiness } from "@/lib/draft-readiness";
import { approveOffNote } from "@/lib/approve-off-note";
import type { Rule } from "@/lib/rules";
import type { Verdict } from "@/lib/judge";
import type { EvidenceCard } from "@/lib/source-presentation";
import type { DraftTag } from "@/app/(app)/tag-actions";
import { postState, STATE_WORD } from "@/lib/post-state";
import { createdLine, worstTone, type WeekPost } from "@/lib/week-model";
import { DraftSources } from "./source-evidence";
import { DraftNotes, type NotesPreview } from "./draft-notes";
import { DraftTags } from "./draft-tags";
import { FollowUpPanel } from "./follow-up-panel";
import { useReaderClock } from "./reader-clock";
import styles from "./week-view.module.css";

/** The short name of each kind of source, as a draft's card and window name it. */
export const SOURCE_SHORT = { newsletter: "Newsletter", blog: "Blog", youtube: "YouTube", github: "GitHub" } as const;

const RESULT_LABEL = { pass: "Follows", fail: "Breaks", unsure: "Not sure" } as const;
const RESULT_TONE = { pass: "success", fail: "danger", unsure: "warning" } as const;
const CHECK_WORD = { success: "OK", warning: "Check", danger: "Will fail" } as const;

/** What one draft's window shows and does, worked out by the week. */
export type DraftView = {
  post: WeekPost;
  /** "LinkedIn, Mon 2 at 9:00". */
  title: string;
  /** The network of the post's channel, for the rules that apply there. */
  network: string;
  live: boolean;
  approved: boolean;
  /** When it was approved on this page, for the line that says so. */
  approvedAt: string | undefined;
  pulled: boolean;
  needsCheck: boolean;
  canCheckAgain: boolean;
  verdicts: Verdict[] | null | undefined;
  checkNote: string | undefined;
  readiness: Readiness | undefined;
  rules: Rule[];
  originOf: (ruleId: string) => string | null;
  evidence: EvidenceCard[];
  notesPreview: NotesPreview | undefined;
  tagsPreview: { selected: DraftTag[]; all: DraftTag[]; canEdit: boolean } | undefined;
  pending: boolean;
};

/** The window's own state: editing, the delete question, the last answer, and whether something is saving. */
export type DraftEdit = {
  editing: string | null;
  setEditing: (text: string | null) => void;
  confirmDelete: boolean;
  setConfirmDelete: (on: boolean) => void;
  note: { ok: boolean; text: string } | null;
  setNote: (note: { ok: boolean; text: string } | null) => void;
  busy: boolean;
};

/** What the window's buttons do. */
export type DraftActions = {
  onSave: (text: string) => void;
  onDelete: () => void;
  onCheckAgain: () => void;
  onMoveBack: () => void;
  onApprove: () => void;
};

/**
 * "Created 2 days ago by Alex Rivera", counted in the reader's own time zone. The server can't know that zone (and the
 * page may be cached), so the line is filled in after load, like LocalTime, instead of rendering a day that may differ.
 */
function CreatedLine({ iso, by, className }: { iso: string; by: string | null; className: string }) {
  const now = useReaderClock();
  return <p className={className}>{now === null ? " " : createdLine(iso, by, now)}</p>;
}

/** Under the title: scheduled once approved, else whether it was edited, its state and where it came from. */
function description(d: DraftView): string {
  const p = d.post;
  if (d.approved) return STATE_WORD.scheduled;
  if (p.editedFrom && worstTone(p) === "success") return "You edited this draft";
  return `${STATE_WORD[postState(p)]}${p.source ? `, from your ${SOURCE_SHORT[p.source.kind].toLowerCase()}` : ""}`;
}

/** The post with Edit beside it; editing turns this same spot into the editor. */
function PostOrEditor({ d, e, a }: { d: DraftView; e: DraftEdit; a: DraftActions }) {
  const p = d.post;
  const { editing } = e;
  if (editing !== null) {
    return (
      <div className={styles.editInPlace}>
        <Textarea label="Draft text" autoFocus value={editing} onChange={(ev) => e.setEditing(ev.target.value)} rows={6} />
        <div className={styles.actions}>
          <Button variant="primary" size="sm" disabled={e.busy || !editing.trim() || editing.trim() === p.text} onClick={() => a.onSave(editing)}>{e.busy ? "Checking and saving…" : "Save"}</Button>
          <Button variant="ghost" size="sm" disabled={e.busy} onClick={() => e.setEditing(null)}>Cancel</Button>
        </div>
      </div>
    );
  }
  return (
    <>
      <div className={styles.postHead}>
        <h3 className={styles.h3}>Post</h3>
        {p.ours !== false && !d.approved && (
          <Button variant="secondary" size="sm" onClick={() => { e.setEditing(p.text); e.setConfirmDelete(false); e.setNote(null); }}><Pencil size={14} strokeWidth={1.75} aria-hidden="true" />Edit</Button>
        )}
      </div>
      <p className={styles.postText}>{p.text}</p>
      {(d.live || d.tagsPreview) && <DraftTags key={`tags-${p.id}`} postId={p.id} preview={d.tagsPreview} />}
      {p.createdAt && <CreatedLine iso={p.createdAt} by={p.createdBy ?? null} className={styles.muted} />}
    </>
  );
}

/** Where the draft came from: its checked quotes when it has them, else the source it was written from. */
function DraftOrigin({ d }: { d: DraftView }) {
  const p = d.post;
  if (d.evidence.length) return <DraftSources cards={d.evidence} live={d.live} footerChecks={d.canCheckAgain} />;
  return p.source && (
    <div className={styles.sourceBox}>
      <div>
        <strong>{`${p.source.foundBy}: ${p.source.label}`}</strong>
        <p className={styles.muted}>{p.source.detail}</p>
      </div>
    </div>
  );
}

/** One playbook verdict: how the draft did, the rule, what was found, and where the rule came from. */
function VerdictRow({ r, d }: { r: Verdict; d: DraftView }) {
  const origin = d.originOf(r.ruleId);
  return (
    <div className={styles.check}>
      <Badge tone={RESULT_TONE[r.verdict]} size="sm">{RESULT_LABEL[r.verdict]}</Badge>
      <span>{r.rule}{r.quote ? ` Found "${r.quote}".` : ""}{r.verdict !== "pass" && r.reason ? ` ${r.reason}` : ""}{origin && <span className={styles.ruleWhy}>{` Came from: ${origin}.`}</span>}</span>
    </div>
  );
}

/** The playbook verdicts the draft was saved with: a broken rule in full, the followed ones folded into one line. */
function Verdicts({ d }: { d: DraftView }) {
  const v = d.verdicts;
  if (v === undefined) return null;
  // A live draft already carries this as a Check row below; saying it here too repeated it.
  if (v === null) return d.live && d.post.status === "draft" ? null : <p className={styles.muted}>{d.checkNote ?? "No current playbook check is available for this draft."}</p>;
  const passed = v.filter(r => r.verdict === "pass");
  const problems = v.filter(r => r.verdict !== "pass");
  const playbook = d.live ? "/playbook" : "/demo?to=/playbook";
  return <>
    {/* A rule the draft breaks always shows in full; the ones it follows fold into one line. */}
    {problems.map((r) => <VerdictRow key={r.ruleId} r={r} d={d} />)}
    {v.length === 0 && <p className={styles.muted}>No playbook rules yet. <a className={styles.rulesLink} href={playbook}>Open your playbook</a></p>}
    {passed.length > 0 && (
      <details className={styles.ruleSummary}>
        <summary><CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" className={styles.passIcon} /><span>{`${passed.length} playbook rule${passed.length === 1 ? "" : "s"} ${problems.length ? "followed" : "passed"}`}</span><span className={styles.viewRules}>View rules</span></summary>
        {passed.map((r) => <VerdictRow key={r.ruleId} r={r} d={d} />)}
        <a className={styles.rulesLink} href={playbook}>Open your playbook</a>
      </details>
    )}
    {!d.live && <p className={styles.muted}>Example verdicts.</p>}
  </>;
}

/** The rules set for the post's account now, folded: which apply, why, and where each came from. */
function AccountRules({ d }: { d: DraftView }) {
  if (!d.rules.length) return null;
  const lines = rulesForAccount(d.rules, d.network, d.post.channel);
  const on = lines.filter(l => l.applies).length;
  return lines.length > 0 && <details className={styles.ruleSummary}>
    <summary><span>{`${on} rule${on === 1 ? "" : "s"} set for this account`}</span><span className={styles.viewRules}>View</span></summary>
    <p className={styles.muted}>Your current settings. The check above shows how this draft did when it was last checked.</p>
    <ul className={styles.ruleLines}>
      {lines.map(l => <li key={l.rule.id} data-off={!l.applies}>
        <span className={styles.ruleText}>{l.rule.text}</span>
        <span className={styles.ruleWhy}>{l.from} · {l.why}{d.originOf(l.rule.id) ? ` · ${d.originOf(l.rule.id)}` : ""}</span>
      </li>)}
    </ul>
  </details>;
}

/** The checks section: playbook verdicts, Buffer's and the sources' checks, and the account's rules. */
function DraftChecks({ d }: { d: DraftView }) {
  // A broken rule already shows above as its own failed row, so its readiness row would say the same thing twice.
  const repeated = (label: string) => d.readiness?.state === "breaks" && label === d.readiness.reason && !!d.verdicts?.some((r) => r.verdict === "fail");
  return (
    <section className={styles.checks} aria-labelledby="draft-checks">
      <h3 id="draft-checks" className={styles.h3}>Checks</h3>
      <Verdicts d={d} />
      {d.post.checks?.filter((c) => !repeated(c.label)).map((c) => (
        <div key={c.label} className={styles.check}>
          <Badge tone={c.tone} size="sm">{CHECK_WORD[c.tone]}</Badge>
          <span>{c.label}</span>
        </div>
      ))}
      <AccountRules d={d} />
    </section>
  );
}

/** The line in the bottom bar: the last answer, else where the post stands and why Approve is off when it is. */
function FootNote({ d, note }: { d: DraftView; note: DraftEdit["note"] }) {
  const p = d.post;
  if (note) return <p className={styles.footNote} role={note.ok ? "status" : "alert"}>{note.text}</p>;
  // A post that left the drafts (approved, or scheduled in Buffer) has no writing record on this page, so its state
  // is said before the "did not write" line, which is only about drafts.
  if (p.status === "scheduled" && !d.approved) return <p className={styles.footNote}>Scheduled in Buffer. Move it back to draft to keep it without posting.</p>;
  if (p.status === "draft" && d.pulled) return <p className={styles.footNote}>You took this off the schedule. It is left out of Approve all; approve it here to schedule it again.</p>;
  if (p.status === "sent") return <p className={styles.footNote}>Published by Buffer.</p>;
  if (p.ours === false && p.status === "draft" && !d.approved) return <p id="approve-foreign" className={styles.footNote}>Queue Pilot did not write this draft. Change or schedule it in Buffer.</p>;
  if (d.approved) return <p className={styles.footNote}>{`Scheduled in Buffer. ${approverLine(APPROVED_IN_APP, d.approvedAt)}${d.live ? "" : " (example)"}.`}</p>;
  if (d.needsCheck) return <p id="approve-playbook" className={styles.footNote}>{approveOffNote(d.readiness)}</p>;
  if (worstTone(p) === "danger") return <p id="approve-off" className={styles.footNote}>This post would fail in Buffer, so it cannot be approved yet. Fix the problem and Approve turns on.</p>;
  return <p className={[styles.footNote, styles.footState].join(" ")}><CircleCheck size={15} strokeWidth={1.75} aria-hidden="true" />Saved as a draft in Buffer</p>;
}

/** The note that says why Approve is off, for the button's description; none while it can be approved. */
function approveHint(d: DraftView): string | undefined {
  const p = d.post;
  if (p.status === "scheduled" || d.approved) return undefined;
  if (p.ours === false) return "approve-foreign";
  if (d.needsCheck) return "approve-playbook";
  return worstTone(p) === "danger" ? "approve-off" : undefined;
}

/** The Approve button's words: approved, already scheduled, or the action. */
function approveLabel(d: DraftView): string {
  if (d.approved) return "Approved";
  return d.post.status === "scheduled" ? "Scheduled" : "Approve & schedule";
}

/** The decision bar: the delete question, or the note with Check again, More, Move back to draft and Approve. */
function DraftFooter({ d, e, a }: { d: DraftView; e: DraftEdit; a: DraftActions }) {
  const p = d.post;
  if (e.confirmDelete) {
    return (
      <div className={styles.footer}>
        <p className={styles.footNote}>Delete this draft from Buffer? The time becomes empty again.</p>
        <div className={styles.actions}>
          <Button variant="ghost" size="sm" disabled={e.busy} onClick={() => e.setConfirmDelete(false)}>Keep it</Button>
          <Button variant="danger" size="sm" disabled={e.busy} onClick={a.onDelete}>{e.busy ? "Deleting…" : "Delete draft"}</Button>
        </div>
      </div>
    );
  }
  const off = p.status !== "draft" || p.ours === false || worstTone(p) === "danger" || d.needsCheck || d.approved || d.pending;
  return (
    <div className={styles.footer}>
      <FootNote d={d} note={e.note} />
      <div className={styles.actions}>
        {d.canCheckAgain && <Button variant="secondary" disabled={e.busy} onClick={a.onCheckAgain}>Check again</Button>}
        {p.ours !== false && !d.approved && (
          <DropdownMenu label="More" icon={<MoreHorizontal size={16} strokeWidth={1.75} />} items={[{ label: "Delete draft", destructive: true, icon: <Trash2 size={15} strokeWidth={1.75} />, onSelect: () => { e.setConfirmDelete(true); e.setEditing(null); e.setNote(null); } }]} />
        )}
        {d.live && p.status === "scheduled" && !d.approved && <Button variant="secondary" disabled={e.busy} onClick={a.onMoveBack}>Move back to draft</Button>}
        <Button variant="primary" disabled={off} aria-describedby={approveHint(d)} onClick={a.onApprove}>
          {approveLabel(d)}
        </Button>
      </div>
    </div>
  );
}

/**
 * The draft window. `inline` draws it in the page instead of over the week (the homepage shows one this way), and then
 * it cannot be closed.
 */
export function DraftWindow({ d, e, a, open, inline, onOpenChange, opener }: { d: DraftView | null; e: DraftEdit; a: DraftActions; open: boolean; inline: boolean; onOpenChange: (open: boolean) => void; opener: RefObject<HTMLButtonElement | null> }) {
  return (
    <Dialog open={open && d !== null} onOpenChange={inline ? undefined : onOpenChange} modal={!inline}>
      {d && (
      <DialogContent
        inline={inline}
        className={styles.dialog}
        onCloseAutoFocus={(ev) => { ev.preventDefault(); opener.current?.focus(); }}
        title={d.title}
        description={description(d)}
      >
      <div className={styles.panel}>
        <div className={styles.panelMain}>
        <PostOrEditor d={d} e={e} a={a} />
        {d.post.editedFrom && (
          <div className={styles.sourceBox}>
            <div>
              <strong>You changed it</strong>
              <p className={styles.muted}><del><span className="sr-only">Before: </span>{d.post.editedFrom}</del></p>
            </div>
          </div>
        )}
        <DraftOrigin d={d} />
        </div>
        <div className={styles.panelSide}>
        <DraftChecks d={d} />
        {(d.live || d.notesPreview) && <DraftNotes key={d.post.id} postId={d.post.id} preview={d.notesPreview} />}
        {d.live && d.post.status !== "sent" && <FollowUpPanel key={`follow-${d.post.id}`} bufferPostId={d.post.id} draftText={d.post.text} />}
        </div>
      </div>
      {/* The decision stays in view: a fixed bar at the bottom of the window, as Buffer keeps a post's actions in one row. */}
      <DraftFooter d={d} e={e} a={a} />
      </DialogContent>
      )}
    </Dialog>
  );
}
