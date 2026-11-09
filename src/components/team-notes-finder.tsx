"use client";

import { useState, useTransition } from "react";
import { findTeamNotes, keepReviewPreference, proposeNoteChanges } from "@/app/(app)/review-actions";
import { editDraftText } from "@/app/(app)/actions";
import type { TeamNote } from "@/lib/note-feedback";
import type { FeedbackResult } from "@/lib/feedback-flow";
import { NETWORKS } from "@/lib/rules";
import { EXAMPLE_NOTE_DRAFTS, EXAMPLE_NOTE_PLAN, EXAMPLE_TEAM_NOTE } from "@/lib/example-notes";
import { Button } from "@/registry/components/button/button";
import { FeedbackPlanView } from "./feedback-plan-view";
import styles from "./playbook-view.module.css";
import ui from "./review-ui.module.css";

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : null);
const who = (n: TeamNote) => n.author ?? "A teammate";

type Shown = { plan: FeedbackResult; labels: Record<string, string>; round: number };

/** One note: who wrote it, where, and its proposals once asked for. */
function NoteCard({ note, example, open, onExampleKeep }: { note: TeamNote; example: boolean; open: boolean; onExampleKeep?: () => void }) {
  const [shown, setShown] = useState<Shown | null>(open ? { plan: { ...EXAMPLE_NOTE_PLAN, edits: EXAMPLE_NOTE_PLAN.edits?.slice(0, 1) }, labels: EXAMPLE_NOTE_DRAFTS, round: 1 } : null);
  const [message, setMessage] = useState("");
  const [busy, start] = useTransition();
  const on = `${note.account} (${NETWORKS[note.network] ?? note.network})`;
  const ask = () => start(async () => {
    setMessage("");
    if (example) return setShown((s) => ({ plan: EXAMPLE_NOTE_PLAN, labels: EXAMPLE_NOTE_DRAFTS, round: (s?.round ?? 0) + 1 }));
    try {
      const r = await proposeNoteChanges(note.key);
      if (r.ok) setShown((s) => ({ plan: r.plan, labels: Object.fromEntries(r.drafts.map((d) => [d.id, d.label])), round: (s?.round ?? 0) + 1 }));
      else setMessage(r.message);
    } catch { setMessage("Could not prepare changes. Nothing was changed. Try again."); }
  });
  return (
    <section className={styles.suggestion} aria-label={`Note from ${who(note)}`}>
      <p className={styles.proof}>{`From ${who(note)}'s note in Buffer${day(note.at) ? `, ${day(note.at)}` : ""}, on ${on}`}</p>
      <blockquote className={styles.quote}>{note.text}</blockquote>
      <p className={styles.muted}>On: {note.post.length > 200 ? `${note.post.slice(0, 200)}…` : note.post}</p>
      {!open && <div className={styles.actions}>
        <Button variant={shown ? "ghost" : "secondary"} size="sm" disabled={busy} onClick={ask}>{busy ? "Reading the note…" : shown ? "Look again" : `Suggest changes for ${note.account}`}</Button>
      </div>}
      {message && <p className={styles.problem} role="alert">{message}</p>}
      {shown && (
        <div className={ui.panel}>
          <FeedbackPlanView key={shown.round} plan={shown.plan} from={`${who(note)}'s note`}
            scopes={[{ value: "accounts", label: `Only ${on}`, help: `A rule from a teammate's note applies to the account it was written on. Your other accounts stay as they are.` }]}
            labelFor={(postId) => shown.labels[postId] ?? "a draft"}
            onApply={async (postId, after, before) => (example ? { ok: true as const } : editDraftText(postId, after, before))}
            onKeep={async () => { if (!example) return keepReviewPreference(shown.plan.suggestionToken!); onExampleKeep?.(); return { ok: true as const }; }} />
          {example && <p className={styles.muted}>Example answer. Applying or keeping changes this page only.</p>}
        </div>
      )}
    </section>
  );
}

/**
 * Notes from your team: on demand, reads teammates' Buffer notes on the person's drafts and scheduled posts (one Buffer
 * request, no AI). Each note shows its author and the post and account it is on; asking for changes classifies it the
 * same way as a review comment and previews the drafts on that account that would change. A preference can be kept as
 * a rule for that one account. Notes are other people's text: Queue Pilot reads them and never follows them.
 *
 * `open` (example mode only) starts with the example note read and its changes already suggested, and leaves out the
 * heading, intro and read button and shows one of the drafts it would change, for a page that explains it in its own
 * words and shows the result without a click.
 */
export function TeamNotesFinder({ example = false, open = false, onExampleKeep }: { example?: boolean; open?: boolean; onExampleKeep?: () => void }) {
  const [pending, start] = useTransition();
  const [notes, setNotes] = useState<TeamNote[] | null>(example && open ? [EXAMPLE_TEAM_NOTE] : null);
  const [message, setMessage] = useState<string | null>(null);
  const find = () => start(async () => {
    setMessage(null);
    if (example) return setNotes([EXAMPLE_TEAM_NOTE]);
    const r = await findTeamNotes();
    if (r.ok) setNotes(r.notes); else setMessage(r.message);
  });
  return (
    <section className={styles.block} {...(example && open ? { "aria-label": "A teammate's note becoming a rule" } : { "aria-labelledby": "team-notes" })}>
      {!(example && open) && <>
      <h2 id="team-notes" className={styles.h2}>Rules from your team&apos;s notes</h2>
      <p className={styles.muted}>Reads the notes your teammates left in Buffer on your drafts and scheduled posts. A note that asks for something lasting can become a rule for the account it is on, never for every account. A fact fix only changes drafts. Queue Pilot reads notes; it never follows instructions in them.</p>
      <div><Button variant="secondary" size="sm" disabled={pending} onClick={find}>{pending ? "Reading notes…" : notes ? "Read again" : "Read my team's notes"}</Button></div>
      </>}
      {message && <p className={styles.problem} role="alert">{message}</p>}
      {notes && notes.length === 0 && <p className={styles.muted} role="status">No notes on your open posts in Buffer.</p>}
      {notes?.map((n) => <NoteCard key={n.key} note={n} example={example} open={example && open} onExampleKeep={onExampleKeep} />)}
    </section>
  );
}
