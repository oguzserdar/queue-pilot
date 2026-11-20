"use client";

import type { EvidenceCard } from "@/lib/source-presentation";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { approveDrafts, deleteMyDraft, editDraftText, moveBackToDraft, recheckMyDrafts } from "@/app/(app)/actions";
import { approveProblem } from "@/lib/approve-problem";
import { recheckSourceEvidence } from "@/app/(app)/source-actions";
import { Button } from "@/registry/components/button/button";
import { Alert } from "@/registry/components/alert/alert";
import type { Readiness } from "@/lib/draft-readiness";
import type { Rule } from "@/lib/rules";
import type { Verdict } from "@/lib/judge";
import { EXAMPLE_VERDICTS } from "@/lib/example-verdicts";
import { WriteWeekButton, type FillEvent } from "./write-week-button";
import { AccountsComposer } from "./accounts-composer";
import type { NotesPreview } from "./draft-notes";
import type { DraftTag } from "@/app/(app)/tag-actions";
import { ShareReviewButton } from "./share-review-button";
import type { WritingAvailability } from "@/lib/writing-availability";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { NEW_POST_EVENT, PAGE_ACTION_EVENT } from "./keyboard-shortcuts";
import { type ComposerSlot } from "./slot-composer";
import { PostComposer } from "./post-composer";
import { cellEntries, firstEmptySlot, slotKey, type WeekModel, type WeekPost } from "@/lib/week-model";
import { DraftWindow, type DraftActions, type DraftEdit, type DraftView } from "./week-draft-window";
import { DraftCell, EmptyCell, PassedCell, PostedCell, WritingCell } from "./week-cells";
import { ApproveAll, ComposerFor, FULL_DAY, NoChannels, WeekGrid, WouldFail } from "./week-parts";
import { exampleSamples, originFor, weekFacts, weekSub, weekTitle, type Counts, type Fill, type Result } from "./week-words";
import styles from "./week-view.module.css";


type WeekProps = { week: WeekModel; /** Signed in without Buffer: only Mastodon and Bluesky rows, planned and posted by Queue Pilot itself. */ noBuffer?: boolean; /** Posts the person took off the schedule in Buffer; left out of Approve all. */ pulledBack?: string[]; /** The moment the page was built (ISO), from the server. Times before it have passed: no draft can be written into them and a draft sitting on one is overdue. Absent in the example. */ nowIso?: string; /** Which week is drawn: the one today is in, or the following one (the default). */ which?: "this" | "next"; /** Draw only this draft's window, inline in the page, as the homepage shows it. */ showDraft?: string; approvals?: Record<string, string>; notesPreview?: Record<string, NotesPreview>; tagsPreview?: Record<string, { selected: DraftTag[]; all: DraftTag[]; canEdit: boolean }>; evidence?: EvidenceCard[]; readiness?: Record<string, Readiness>; rules?: Rule[]; checkNotes?: Record<string, string>; live?: boolean; verdicts?: Record<string, Verdict[] | null>; writing?: WritingAvailability; writeCount?: number; /** Every empty time the fill can still write to (channels Queue Pilot can write to); absent, the count of empty times shown. */ writeTotal?: number };

/** While a fill runs, the times it writes into show it, and each fills in when its draft arrives. */
function useFill() {
  const [writingNow, setWritingNow] = useState(false);
  const [fill, setFill] = useState<Fill>({ ids: new Set(), texts: {} });
  // The page knows a fill is on, so the example's sign-in card steps aside and does not cover the week.
  useEffect(() => { document.body.toggleAttribute("data-filling", writingNow); return () => document.body.removeAttribute("data-filling"); }, [writingNow]);
  // A dropped time goes back to empty: its placeholder is cleared and no text was ever shown for it.
  const onFill = (event: FillEvent) => setFill((f) => {
    if (event.type === "start") return { ids: new Set(event.slotIds), texts: {} };
    if (event.type === "dropped") { const ids = new Set(f.ids); ids.delete(event.slotId); const { [event.slotId]: _gone, ...texts } = f.texts; return { ids, texts }; }
    return { ids: f.ids, texts: { ...f.texts, [event.slotId]: event.text } };
  });
  return { writingNow, setWritingNow, fill, onFill };
}

/** Approving: marks what was scheduled (with when, for the window's line) and says what went wrong. */
function useApprove(live: boolean, onTrouble: (trouble: { title: string; text: string }) => void) {
  const { toast } = useToastStack();
  const [approved, setApproved] = useState<Map<string, string>>(new Map());
  const [pending, start] = useTransition();
  const [problem, setProblem] = useState<{ title: string; text: string } | null>(null);
  const markApproved = (ids: string[]) => {
    const at = new Date().toISOString();
    setApproved((m) => new Map([...m, ...ids.map((id): [string, string] => [id, at])]));
  };
  const approve = (ids: string[], opts?: { one?: boolean }) => {
    if (!live) { markApproved(ids); toast({ type: "success", title: `${ids.length} approved`, description: "On this example page only." }); return; }
    setProblem(null);
    start(async () => {
      const res = await approveDrafts(ids, opts);
      const trouble = approveProblem(res);
      setProblem(trouble);
      if (trouble) onTrouble(trouble);
      if (!res.ok) return;
      markApproved(res.approved);
      if (res.approved.length) toast({ type: "success", title: `${res.approved.length} post${res.approved.length === 1 ? "" : "s"} scheduled in Buffer`, ...(res.note ? { description: res.note } : {}) });
    });
  };
  return { approved, pending, problem, approve };
}

/** "N then P" (or ?new=1 from another page) opens the composer on the next empty slot. */
function useNewPost(week: WeekModel, posts: WeekPost[], name: string, setComposing: (s: ComposerSlot) => void, setComposed: (line: string) => void) {
  useEffect(() => {
    const openNext = () => {
      const s = firstEmptySlot({ ...week, posts });
      if (!s) return setComposed(`Every slot ${name.toLowerCase()} already has a post.`);
      const ch = week.channels.find((c) => c.id === s.channelId);
      setComposing({ id: week.slotIds?.[slotKey(s.channelId, s.day, s.time)], name: `${ch?.name ?? ""}, ${FULL_DAY[s.day]} at ${s.time}`, service: ch?.service });
    };
    if (new URLSearchParams(window.location.search).get("new") === "1") {
      window.history.replaceState(null, "", window.location.pathname);
      openNext();
    }
    window.addEventListener(NEW_POST_EVENT, openNext);
    return () => window.removeEventListener(NEW_POST_EVENT, openNext);
  }, [week, posts, name, setComposing, setComposed]);
}

/** Palette actions: "approve" asks to approve every ready draft, "share" opens the share dialog. */
function usePageActions(canApproveAll: boolean, hasDrafts: boolean, setConfirmAll: (on: boolean) => void, setShareSignal: (f: (n: number) => number) => void) {
  useEffect(() => {
    const act = (name: unknown) => { if (name === "approve" && canApproveAll) setConfirmAll(true); if (name === "share" && hasDrafts) setShareSignal((n) => n + 1); };
    const q = new URLSearchParams(window.location.search).get("do");
    if (q) { window.history.replaceState(null, "", window.location.pathname); act(q); }
    const on = (e: Event) => act(e instanceof CustomEvent ? e.detail : undefined);
    window.addEventListener(PAGE_ACTION_EVENT, on);
    return () => window.removeEventListener(PAGE_ACTION_EVENT, on);
  }, [canApproveAll, hasDrafts, setConfirmAll, setShareSignal]);
}

/** The draft window's own state, and `run`, which saves a change and says how it went in the window's footer. */
function useDraftEdit(live: boolean, closeWindow: () => void): { edit: DraftEdit; run: (act: () => Promise<Result>, done: string, close?: boolean) => void } {
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, startEdit] = useTransition();
  const router = useRouter();
  const { toast } = useToastStack();
  const run = (act: () => Promise<Result>, done: string, close = false) =>
    startEdit(async () => {
      const r = await act();
      if (!r.ok) return setNote({ ok: false, text: r.message });
      setNote({ ok: true, text: r.title ? `${done} ${r.title}` : done });
      setEditing(null);
      setConfirmDelete(false);
      if (live) router.refresh();
      if (close) { closeWindow(); toast({ type: "success", title: done, description: r.title }); }
    });
  return { edit: { editing, setEditing, confirmDelete, setConfirmDelete, note, setNote, busy }, run };
}

/** The footer's "Check again" is the one place a draft is rechecked: against the playbook, then against its sources. */
async function checkAgain(id: string, evidence: EvidenceCard[]): Promise<Result> {
  const checked = await recheckMyDrafts([id]);
  if (!checked.ok) return checked;
  if (!evidence.some((e) => e.postId === id && e.needsCheck)) return { ok: true };
  const sources = await recheckSourceEvidence(id);
  return sources.ok ? { ok: true } : { ok: false, message: sources.message };
}

type ActionDeps = { live: boolean; evidence: EvidenceCard[]; run: ReturnType<typeof useDraftEdit>["run"]; setEdited: (f: (m: Record<string, string>) => Record<string, string>) => void; setGone: (f: (s: Set<string>) => Set<string>) => void; approve: (ids: string[], opts?: { one?: boolean }) => void };

/** What the draft window's buttons do for this draft; in example mode edits and deletes change the screen only. */
function draftActions(current: WeekPost | undefined, x: ActionDeps): DraftActions {
  const { live, run } = x;
  return {
    onSave: (text) => { if (current) run(async () => {
      if (!live) { x.setEdited((m) => ({ ...m, [current.id]: text.trim() })); return { ok: true as const }; }
      return editDraftText(current.id, text, current.text);
    }, live ? "Saved in Buffer. It is still a draft." : "Changed on this example page only."); },
    onDelete: () => { if (current) run(async () => {
      if (!live) { x.setGone((s) => new Set(s).add(current.id)); return { ok: true as const }; }
      return deleteMyDraft(current.id);
    }, live ? "Draft deleted from Buffer. Its time is empty again." : "Removed on this example page only.", true); },
    onCheckAgain: () => { if (current) run(() => checkAgain(current.id, x.evidence), "Checked against your playbook and its sources."); },
    onMoveBack: () => { if (current) run(() => moveBackToDraft(current.id), "Moved back to draft. It will not post until you schedule it again."); },
    onApprove: () => { if (current) x.approve([current.id], { one: true }); },
  };
}

type ViewDeps = { week: WeekModel; live: boolean; props: WeekProps; verdicts: Record<string, Verdict[] | null>; approved: Map<string, string>; pending: boolean; facts: ReturnType<typeof weekFacts> };

/** What the open draft's window shows, or null when no draft is open. */
function draftView(current: WeekPost | undefined, x: ViewDeps): DraftView | null {
  if (!current) return null;
  const { week, live, props, verdicts, approved, facts } = x;
  const { readiness = {}, checkNotes = {}, evidence = [], rules = [] } = props;
  const channel = week.channels.find((c) => c.id === current.channel);
  const needsCheck = facts.needsCheck(current.id);
  return {
    post: current, live, rules, pending: x.pending, readiness: readiness[current.id], verdicts: verdicts[current.id], checkNote: checkNotes[current.id],
    title: `${channel?.name ?? ""}, ${week.days[current.day]} at ${current.time}`,
    network: channel?.service ?? "",
    approved: approved.has(current.id), approvedAt: approved.get(current.id), pulled: facts.pulled.has(current.id),
    needsCheck, canCheckAgain: current.ours !== false && !approved.has(current.id) && live && (verdicts[current.id] === null || needsCheck),
    originOf: (id) => originFor(rules, id),
    evidence: evidence.filter(e => e.postId === current.id), notesPreview: props.notesPreview?.[current.id], tagsPreview: props.tagsPreview?.[current.id],
  };
}

type CellDeps = { week: WeekModel; live: boolean; posts: WeekPost[]; writingNow: boolean; replayed: Set<string>; fill: Fill; passed: (c: string, day: number, t: string) => boolean; overdue: Set<string>; approved: Map<string, string>; approvals: Record<string, string>; evidence: EvidenceCard[]; openId: string | undefined; cellId: (c: string, day: number, t: string) => string; onCompose: (slot: ComposerSlot) => void; onOpen: (id: string, button: HTMLButtonElement) => void };

/** An empty posting time: being written by a fill, passed, or open to write into. */
function emptyCell(x: CellDeps, channelId: string, day: number, t: string): ReactNode {
  const channel = x.week.channels.find((c) => c.id === channelId);
  const name = `${channel?.name ?? ""}, ${FULL_DAY[day]} at ${t}`;
  const id = x.cellId(channelId, day, t);
  // The example keeps its sample line in the empty time after the replay, so the week you watched stays written.
  if (x.fill.ids.has(id) && (x.writingNow || (!x.live && x.fill.texts[id] !== undefined))) return <WritingCell key={t} time={t} name={name} text={x.fill.texts[id]} />;
  if (x.passed(channelId, day, t)) return <PassedCell key={t} time={t} name={name} />;
  return <EmptyCell key={t} time={t} name={name} onWrite={() => x.onCompose({ id: x.week.slotIds?.[slotKey(channelId, day, t)], name, service: channel?.service })} />;
}

/** One cell's slots and posts, shared by the desktop grid and the phone day list. */
function cellsFor(x: CellDeps, channelId: string, day: number): ReactNode[] {
  return cellEntries({ ...x.week, posts: x.posts }, channelId, day).flatMap<ReactNode>(({ time: t, posts: all }) => {
    const here = x.writingNow && !x.live ? all.filter((p) => !x.replayed.has(p.id)) : all;
    if (!here.length) return [emptyCell(x, channelId, day, t)];
    return here.map((p) => {
      if (p.status !== "draft") return <PostedCell key={p.id} time={t} post={p} approval={x.approvals[p.id]} />;
      return <DraftCell key={p.id} time={t} post={p} citation={x.evidence.find(e => e.postId === p.id)} approved={x.approved.has(p.id)} selected={x.openId === p.id} overdue={x.overdue.has(p.id)}
        onOpen={(button) => x.onOpen(p.id, button)} />;
    });
  });
}

/** The page's props with their defaults filled in. */
function withDefaults(props: WeekProps) {
  const live = props.live ?? false;
  return {
    ...props, live, which: props.which ?? "next", noBuffer: props.noBuffer ?? false,
    verdicts: props.verdicts ?? (live ? {} : EXAMPLE_VERDICTS),
    readiness: props.readiness ?? {}, checkNotes: props.checkNotes ?? {}, pulledBack: props.pulledBack ?? [],
    approvals: props.approvals ?? {}, evidence: props.evidence ?? [],
  };
}

/** The week's name, what it holds, and a link to the other week when signed in. */
function WeekHead({ name, counts, label, live, noBuffer, which, writing }: { name: string; counts: Counts; label: string; live: boolean; noBuffer: boolean; which: "this" | "next"; writing: WritingAvailability | undefined }) {
  return (
    <div>
      <h1 className={styles.title}>{weekTitle(name, counts)}</h1>
      <p className={styles.sub}>
        <span className="tnum">{label}</span>.{" "}
        {weekSub(counts, { live, noBuffer, which, writing })}
      </p>
      {live && (
        <p className={styles.sub}>
          {which === "this" ? <a href="/week">Show next week</a> : <a href="/week?w=this">Show this week</a>}
        </p>
      )}
    </div>
  );
}

/** "New post": opens the composer when signed in; the example says what it would do. */
function NewPostButton({ live, onOpen }: { live: boolean; onOpen: () => void }) {
  const { toast } = useToastStack();
  return <Button variant="secondary" size="md" onClick={() => (live ? onOpen() : toast({ type: "info", title: "Sign in with Buffer to write a new post", description: "On your own queue it is saved as a draft for each account you pick." }))}>New post</Button>;
}

/** Fill the week, shown while there are empty times (or, in the example, times to replay). */
function FillButton({ live, open, samples, writing, writeCount, writeTotal, which, onWriting, onProgress }: { live: boolean; open: number; samples: { slotId: string; text?: string }[]; writing: WritingAvailability | undefined; writeCount: number | undefined; writeTotal: number | undefined; which: "this" | "next"; onWriting: (on: boolean) => void; onProgress: (e: FillEvent) => void }) {
  if (!(open > 0 || (!live && samples.length > 0)) || !writing) return null;
  const count = live ? writeCount ?? 0 : samples.length;
  const total = live ? (writeTotal ?? open) : samples.length;
  return <WriteWeekButton availability={writing} count={count} total={total} inlineActions example={!live} week={which} onWriting={onWriting} onProgress={onProgress} samples={samples} />;
}

/** The new-post composer: the direct one without Buffer, else the Buffer one for several accounts. */
function NewPostComposer({ noBuffer, open, onClose }: { noBuffer: boolean; open: boolean; onClose: () => void }) {
  const router = useRouter();
  const { toast } = useToastStack();
  if (noBuffer) return open && <PostComposer recent={[]} startOpen onClose={() => { onClose(); router.refresh(); }} />;
  return <AccountsComposer open={open} onClose={(saved) => { onClose(); if (saved) toast({ type: "success", title: saved }); }} />;
}

/**
 * `live` is true for a signed-in user: Approve schedules the drafts in Buffer. Example data only marks them on screen.
 * `verdicts` are the playbook verdicts each draft was saved with, by post id; null means it was saved unchecked.
 */
export function WeekView(props: WeekProps) {
  const all = withDefaults(props);
  const { week, which, live, showDraft, noBuffer, verdicts, evidence } = all;
  const NAME = which === "this" ? "This week" : "Next week";
  const { channels } = week;
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [gone, setGone] = useState<Set<string>>(new Set());
  const router = useRouter();
  const { toast } = useToastStack();
  const [selected, setSelected] = useState<string | undefined>(showDraft);
  // The draft stays selected while the dialog closes, so its content can animate out and focus can return to the draft that opened it.
  const [dialogOpen, setDialogOpen] = useState(showDraft !== undefined);
  // "New post": one post written once for several accounts, saved as a Buffer draft per account.
  const [newPostOpen, setNewPostOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  // Edit and Delete draft in the dialog; in example mode they change the screen only.
  const { edit, run } = useDraftEdit(live, () => setDialogOpen(false));
  // The page's alert sits behind an open draft window, so the window's own footer says it too.
  const { approved, pending, problem, approve } = useApprove(live, (trouble) => { if (dialogOpen) edit.setNote({ ok: false, text: `${trouble.title}. ${trouble.text}` }); });
  const facts = weekFacts({ ...all, gone, edited, approved });
  const { posts, drafts, open, ready, blocked, counts } = facts;
  /** A day gets a full column when any channel has a slot or a post on it. */
  const dayHasContent = (d: number) => channels.some((c) => week.slots[c.id]?.[d]?.length) || posts.some((p) => p.day === d);
  const current = posts.find((p) => p.id === selected);
  // While a fill runs, the times it writes into show it. A time is known by its slot id; the example has none, so it
  // uses the cell's own key and plays on the times a run would pick.
  const { writingNow, setWritingNow, fill, onFill } = useFill();
  const cellId = (c: string, day: number, t: string) => week.slotIds?.[slotKey(c, day, t)] ?? slotKey(c, day, t);
  const { samples, replayed } = live ? { samples: [], replayed: new Set<string>() } : exampleSamples(week, posts, drafts, cellId);

  // The empty slot whose composer is open.
  const [composing, setComposing] = useState<ComposerSlot | null>(null);
  const [composed, setComposed] = useState<string | null>(null);
  useNewPost(week, posts, NAME, setComposing, setComposed);
  const [confirmAll, setConfirmAll] = useState(false);
  const [shareSignal, setShareSignal] = useState(0);
  usePageActions(ready.length > 0 && !writingNow, drafts.length > 0, setConfirmAll, setShareSignal);

  const openDraft = (id: string) => { setSelected(id); edit.setEditing(null); edit.setConfirmDelete(false); edit.setNote(null); setDialogOpen(true); };
  const cells: CellDeps = { week, live, posts, writingNow, replayed, fill, passed: facts.passed, overdue: facts.overdue, approved, approvals: all.approvals, evidence, openId: dialogOpen ? selected : undefined, cellId, onCompose: setComposing, onOpen: (id, button) => { opener.current = button; openDraft(id); } };
  const view = draftView(current, { week, live, props, verdicts, approved, pending, facts });
  const actions = draftActions(current, { live, evidence, run, setEdited, setGone, approve });
  const draftWindow = <DraftWindow d={view} e={edit} a={actions} open={dialogOpen} inline={showDraft !== undefined} onOpenChange={setDialogOpen} opener={opener} />;
  if (showDraft) return draftWindow;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <WeekHead name={NAME} counts={counts} label={week.label} live={live} noBuffer={noBuffer} which={which} writing={props.writing} />
        <div className={styles.headActions}>
          <WouldFail blocked={blocked} channels={channels} onOpen={openDraft} />
          {channels.length > 0 && <NewPostButton live={live} onOpen={() => setNewPostOpen(true)} />}
          <FillButton live={live} open={open} samples={samples} writing={props.writing} writeCount={props.writeCount} writeTotal={props.writeTotal} which={which} onWriting={setWritingNow} onProgress={onFill} />
          {drafts.length > 0 && <ShareReviewButton example={!live} openSignal={shareSignal} drafts={drafts.map((d) => ({ id: d.id, label: `${channels.find((c) => c.id === d.channel)?.name ?? ""}, ${FULL_DAY[d.day]} at ${d.time}`, when: `${FULL_DAY[d.day].slice(0, 3)} ${d.time}`, text: d.text }))} />}
          {drafts.length > 0 && <ApproveAll ready={ready.length} waiting={counts.waiting} approvedAny={approved.size > 0} pending={pending} writingNow={writingNow} confirming={confirmAll} setConfirming={setConfirmAll} onApprove={() => approve(ready.map((p) => p.id))} />}
        </div>
      </header>

      <p className={styles.muted}>Queue Pilot never schedules or publishes on its own. Only your Approve schedules, or your AI when you ask it.</p>

      {composed && <p className={styles.muted} role="status">{composed}</p>}

      {problem && (
        <Alert tone="danger" title={problem.title}>
          {problem.text}
        </Alert>
      )}

      {channels.length === 0 ? <NoChannels noBuffer={noBuffer} /> : <WeekGrid week={week} name={NAME} dayHasContent={dayHasContent} cell={(channelId, day) => cellsFor(cells, channelId, day)} />}

      <NewPostComposer noBuffer={noBuffer} open={newPostOpen} onClose={() => setNewPostOpen(false)} />
      {/* A draft opens in a dialog over the week, the way a calendar opens an event; closing it returns focus to the draft. */}
      <ComposerFor composing={composing} live={live} onDirectClose={() => { setComposing(null); router.refresh(); }} onClose={(saved) => { setComposing(null); if (saved) toast({ type: "success", title: saved }); }} />
      {draftWindow}
    </div>
  );
}
