"use client";

import { DraftSources } from "./source-evidence";
import type { EvidenceCard } from "@/lib/source-presentation";
import { BUFFER_CHANNELS_URL } from "@/lib/connect-links";
import { ArrowUpRight, CircleCheck, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { DropdownMenu } from "@/registry/components/dropdown-menu/dropdown-menu";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDrafts, deleteMyDraft, editDraftText, recheckMyDrafts } from "@/app/(app)/actions";
import { Textarea } from "@/registry/components/textarea/textarea";
import { Button } from "@/registry/components/button/button";
import { Badge } from "@/registry/components/badge/badge";
import { Alert } from "@/registry/components/alert/alert";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/registry/components/popover/popover";
import { rulesForAccount } from "@/lib/rule-explain";
import { APPROVED_IN_APP, approverLine, ruleOrigin } from "@/lib/rule-origin";
import type { Readiness } from "@/lib/draft-readiness";
import { approveOffNote } from "@/lib/approve-off-note";
import type { Rule } from "@/lib/rules";
import type { Verdict } from "@/lib/judge";
import { EXAMPLE_VERDICTS } from "@/lib/example-verdicts";
import { WriteWeekButton } from "./write-week-button";
import { AccountsComposer } from "./accounts-composer";
import { DraftNotes } from "./draft-notes";
import { DraftTags } from "./draft-tags";
import type { DraftTag } from "@/app/(app)/tag-actions";
import type { DraftNote } from "@/app/(app)/note-actions";
import { ShareReviewButton } from "./share-review-button";
import type { WritingAvailability } from "@/lib/writing-availability";
import { ChannelIcon } from "./channel-icon";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { NEW_POST_EVENT, PAGE_ACTION_EVENT } from "./keyboard-shortcuts";
import { postState, STATE_WORD } from "@/lib/post-state";
import { StateMark } from "./state-mark";
import { SlotComposer, type ComposerSlot } from "./slot-composer";
import type { Source } from "@/lib/demo-data";
import { cellEntries, countOpenSlots, firstEmptySlot, slotKey, worstTone, zoneLabel, type WeekModel, type WeekPost as Post, createdLine } from "@/lib/week-model";
import styles from "./week-view.module.css";

const SOURCE_SHORT: Record<Source["kind"], string> = { newsletter: "Newsletter", blog: "Blog", youtube: "YouTube", github: "GitHub" };
const FULL_DAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];



const RESULT_LABEL = { pass: "Follows", fail: "Breaks", unsure: "Not sure" } as const;
const RESULT_TONE = { pass: "success", fail: "danger", unsure: "warning" } as const;

/**
 * `live` is true for a signed-in user: Approve schedules the drafts in Buffer. Example data only marks them on screen.
 * `verdicts` are the playbook verdicts each draft was saved with, by post id; null means it was saved unchecked.
 */
export function WeekView({ week, live = false, verdicts = live ? {} : EXAMPLE_VERDICTS, writing, writeCount = 0, rules = [], checkNotes = {}, readiness = {}, evidence = [], notesPreview, tagsPreview, approvals = {} }: { week: WeekModel; approvals?: Record<string, string>; notesPreview?: Record<string, { notes: DraftNote[]; more: boolean; team: boolean }>; tagsPreview?: Record<string, { selected: DraftTag[]; all: DraftTag[]; canEdit: boolean }>; evidence?: EvidenceCard[]; readiness?: Record<string, Readiness>; rules?: Rule[]; checkNotes?: Record<string, string>; live?: boolean; verdicts?: Record<string, Verdict[] | null>; writing?: WritingAvailability; writeCount?: number }) {
  const { label: WEEK_LABEL, days: DAYS, channels, slots } = week;
  /** A day gets a full column when any channel has a slot or a post on it. */
  const dayHasContent = (d: number) => channels.some((c) => slots[c.id]?.[d]?.length) || posts.some((p) => p.day === d);
  // Edit and Delete draft in the dialog; in example mode they change the screen only.
  const [editing, setEditing] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [edited, setEdited] = useState<Record<string, string>>({});
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [busy, startEdit] = useTransition();
  const router = useRouter();
  const { toast } = useToastStack();
  const run = (act: () => Promise<{ ok: true; title?: string } | { ok: false; message: string }>, done: string, close = false) =>
    startEdit(async () => {
      const r = await act();
      if (!r.ok) return setNote({ ok: false, text: r.message });
      setNote({ ok: true, text: r.title ? `${done} ${r.title}` : done });
      setEditing(null);
      setConfirmDelete(false);
      if (live) router.refresh();
      if (close) { setDialogOpen(false); toast({ type: "success", title: done, description: r.title }); }
    });
  // Example mode shows its own edits and deletions on screen; live mode refreshes from the server instead.
  const posts = week.posts.filter((p) => !gone.has(p.id)).map((p) => ({
    ...p,
    text: edited[p.id] ?? p.text,
    checks: live && p.status === "draft" && readiness[p.id] && readiness[p.id].state !== "ok"
      ? [...(p.checks ?? []), { tone: readiness[p.id].state === "breaks" ? "danger" as const : "warning" as const, label: readiness[p.id].reason ?? "Check this draft before approving." }]
      : live && p.status === "draft" && verdicts[p.id] === null
      ? [...(p.checks ?? []), { tone: "warning" as const, label: checkNotes[p.id] ?? "Needs a current playbook check." }]
      : p.checks,
    // Live verdict entries come from this person's writing records, including drafts saved unchecked.
    ours: live ? Object.hasOwn(verdicts, p.id) : p.ours,
  }));
  const drafts = posts.filter((p) => p.status === "draft");
  // Where each rule came from, from its record (or the example's own words); nothing when nothing was recorded.
  const originOf = (ruleId: string) => { const r = rules.find((x) => x.id === ruleId); return r ? ruleOrigin(r) ?? (r as { origin?: string }).origin ?? null : null; };
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | undefined>();
  // The draft stays selected while the dialog closes, so its content can animate out and focus can return to the draft that opened it.
  const [dialogOpen, setDialogOpen] = useState(false);
  // "New post": one post written once for several accounts, saved as a Buffer draft per account.
  const [newPostOpen, setNewPostOpen] = useState(false);
  const opener = useRef<HTMLButtonElement | null>(null);
  const current = posts.find((p) => p.id === selected);
  const open = countOpenSlots({ ...week, posts });
  const needsCheck = (id: string) => live && (readiness[id]?.state === "check" || readiness[id]?.state === "breaks");
  const ready = drafts.filter((p) => p.ours !== false && worstTone(p) !== "danger" && !needsCheck(p.id) && !approved.has(p.id));
  const blocked = drafts.filter((p) => worstTone(p) === "danger");
  const waiting = drafts.filter((p) => p.ours !== false && !approved.has(p.id)).length;


  // The empty slot whose composer is open.
  const [composing, setComposing] = useState<ComposerSlot | null>(null);
  const [composed, setComposed] = useState<string | null>(null);
  // "N then P" (or ?new=1 from another page) opens the composer on the next empty slot.
  useEffect(() => {
    const openNext = () => {
      const s = firstEmptySlot({ ...week, posts });
      if (!s) return setComposed("Every slot next week already has a post.");
      const ch = channels.find((c) => c.id === s.channelId);
      setComposing({ id: week.slotIds?.[slotKey(s.channelId, s.day, s.time)], name: `${ch?.name ?? ""}, ${FULL_DAY[s.day]} at ${s.time}`, service: ch?.service });
    };
    if (new URLSearchParams(window.location.search).get("new") === "1") {
      window.history.replaceState(null, "", window.location.pathname);
      openNext();
    }
    window.addEventListener(NEW_POST_EVENT, openNext);
    return () => window.removeEventListener(NEW_POST_EVENT, openNext);
  }, [week, posts, channels]);
  const [pending, startApprove] = useTransition();
  const [confirmAll, setConfirmAll] = useState(false);
  const [problem, setProblem] = useState<{ title: string; text: string } | null>(null);
  const markApproved = (ids: string[]) => setApproved((s) => new Set([...s, ...ids]));
  const approve = (ids: string[]) => {
    if (!live) { markApproved(ids); toast({ type: "success", title: `${ids.length} approved`, description: "On this example page only." }); return; }
    setProblem(null);
    startApprove(async () => {
      const res = await approveDrafts(ids);
      if (!res.ok) {
        setProblem({ title: "Nothing was scheduled", text: res.kind === "limited" ? "Buffer's request limit is reached. Try again in a few minutes." : res.kind === "signedOut" ? "Your session ended. Sign in with Buffer again." : "Buffer could not be reached." });
        return;
      }
      markApproved(res.approved);
      if (res.approved.length) toast({ type: "success", title: `${res.approved.length} post${res.approved.length === 1 ? "" : "s"} scheduled in Buffer`, ...(res.note ? { description: res.note } : {}) });
      if (res.refused.length) setProblem({ title: `${res.refused.length} draft${res.refused.length === 1 ? " was" : "s were"} not scheduled`, text: res.refused.map((r) => r.reason).join(" ") });
    });
  };

  // Palette actions: "approve" asks to approve every ready draft, "share" opens the share dialog.
  const [shareSignal, setShareSignal] = useState(0);
  useEffect(() => {
    const act = (name: unknown) => { if (name === "approve" && ready.length) setConfirmAll(true); if (name === "share" && drafts.length) setShareSignal((n) => n + 1); };
    const q = new URLSearchParams(window.location.search).get("do");
    if (q) { window.history.replaceState(null, "", window.location.pathname); act(q); }
    const on = (e: Event) => act((e as CustomEvent).detail);
    window.addEventListener(PAGE_ACTION_EVENT, on);
    return () => window.removeEventListener(PAGE_ACTION_EVENT, on);
  }, [ready.length, drafts.length]);

  /** One cell's slots and posts, shared by the desktop grid and the phone day list. */
  const entriesFor = (channelId: string, day: number) =>
    cellEntries({ ...week, posts }, channelId, day).flatMap(({ time: t, posts: here }) => {
      if (!here.length) {
        const name = `${channels.find((c) => c.id === channelId)?.name ?? ""}, ${FULL_DAY[day]} at ${t}`;
        return [
          <button key={t} type="button" className={styles.empty} aria-label={`Write a post for ${name}`} onClick={() => setComposing({ id: week.slotIds?.[slotKey(channelId, day, t)], name, service: channels.find((c) => c.id === channelId)?.service })}>
            <span>{t}</span>
            <span className={styles.addCue} aria-hidden="true">+ Add</span>
          </button>,
        ];
      }
      return here.map((p) => {
        if (p.status !== "draft") return (
          <div key={p.id} className={styles.existing} data-status={p.status}>
            <span className={styles.time}>{t}<span className={styles.state}><StateMark state={postState(p)} word /></span></span>
            <span className={styles.text}>{p.text}</span>
            {p.status === "error" && <span className={styles.reason}>{p.error?.message || "Buffer did not say why."} This time counts as open again.</span>}
            {approvals[p.id] && <span className={styles.ruleWhy}>{approvals[p.id]}</span>}
          </div>
        );
        const citation = evidence.find(e => e.postId === p.id);
        const tone = worstTone(p);
        const isOn = approved.has(p.id);
        return (
          <button key={p.id} type="button" onClick={(e) => { opener.current = e.currentTarget; setSelected(p.id); setEditing(null); setConfirmDelete(false); setNote(null); setDialogOpen(true); }} className={styles.draft} data-tone={tone} data-selected={dialogOpen && selected === p.id} data-approved={isOn}>
            <span className={styles.time}>{t}<span className={styles.state}><StateMark state={postState(p, isOn)} word why={p.checks?.find((c) => c.tone === "danger")?.label} /></span></span>
            <span className={styles.text}>{p.text}</span>
            <span className={styles.src} title={citation ? `${citation.title} · ${citation.needsCheck ? "Evidence needs review" : "Quote matches saved source"}` : p.source?.label ?? "Draft saved in Buffer"}>{citation ? citation.title : p.source ? SOURCE_SHORT[p.source.kind] : "Buffer draft"}</span>
          </button>
        );
      });
    });

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>
            {channels.length === 0
              ? "Next week"
              : drafts.length > 0
              ? `Next week: ${[
                  waiting && `${waiting} draft${waiting === 1 ? "" : "s"} to approve`,
                  drafts.length - waiting && `${drafts.length - waiting} approved`,
                  open ? `${open} empty slot${open === 1 ? "" : "s"}` : "every slot filled",
                ].filter(Boolean).join(", ")}`
              : open === 0 ? "Next week: every slot has a post" : `Next week: ${open} empty slot${open === 1 ? "" : "s"}`}
          </h1>
          <p className={styles.sub}>
            <span className="tnum">{WEEK_LABEL}</span>.{" "}
            {channels.length === 0
              ? "Nothing to fill yet."
              : drafts.length > 0
              ? `${live ? (waiting ? `${waiting} waiting for your approval` : "No drafts from Queue Pilot are waiting for approval") : "Written from your newsletter, each one checked against your playbook"}${blocked.length ? `. ${blocked.length} can't go out until ${blocked.length === 1 ? "its" : "their"} problem is fixed` : ""}.`
              : "Connect your AI, then pick \"Fill my week\" in it to draft the open slots."}
          </p>
        </div>
        <div className={styles.headActions}>
          {/* Posts that would fail sit behind one button, so the week stays where it is; each card is marked too. */}
          {blocked.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="secondary" size="lg" className={styles.issues}>
                  <span className={styles.issueDot} aria-hidden="true" />
                  {`${blocked.length} post${blocked.length === 1 ? "" : "s"} would fail`}
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className={styles.issueList}>
                {blocked.map((b) => (
                  <div key={b.id} className={styles.issue}>
                    <strong>{`${FULL_DAY[b.day]}'s ${channels.find((c) => c.id === b.channel)?.name ?? ""} post`}</strong>
                    <span>{b.checks?.find((c) => c.tone === "danger")?.label ?? "A check failed for this post."}</span>
                    <Button variant="secondary" size="sm" onClick={() => { setSelected(b.id); setEditing(null); setConfirmDelete(false); setNote(null); setDialogOpen(true); }}>Open post</Button>
                  </div>
                ))}
              </PopoverContent>
            </Popover>
          )}
          {channels.length > 0 && <Button variant="secondary" size="lg" onClick={() => (live ? setNewPostOpen(true) : toast({ type: "info", title: "Sign in with Buffer to write a new post", description: "On your own queue it is saved as a draft for each account you pick." }))}>New post</Button>}
          {open > 0 && writing && <WriteWeekButton availability={writing} count={writeCount} inlineActions example={!live} />}
          {drafts.length > 0 && <ShareReviewButton example={!live} openSignal={shareSignal} drafts={drafts.map((d) => ({ id: d.id, label: `${channels.find((c) => c.id === d.channel)?.name ?? ""}, ${FULL_DAY[d.day]} at ${d.time}`, when: `${FULL_DAY[d.day].slice(0, 3)} ${d.time}`, text: d.text }))} />}
          {drafts.length > 0 && (
            confirmAll ? (
              <>
                <Button variant="ghost" size="lg" autoFocus onClick={() => setConfirmAll(false)}>Cancel</Button>
                <Button variant="primary" size="lg" onClick={() => { setConfirmAll(false); approve(ready.map((p) => p.id)); }}>
                  {`Schedule ${ready.length} post${ready.length === 1 ? "" : "s"} in Buffer`}
                </Button>
              </>
            ) : (
              <Button variant="primary" size="lg" disabled={ready.length === 0 || pending} onClick={() => setConfirmAll(true)}>
                {pending ? "Approving…" : ready.length > 0 ? `Approve ${ready.length} draft${ready.length === 1 ? "" : "s"}` : waiting > 0 || !approved.size ? "Nothing ready to approve" : "All approved"}
              </Button>
            )
          )}
        </div>
      </header>

      <p className={styles.muted}>Queue Pilot never schedules or publishes on its own. Only your Approve schedules, or your AI when you ask it.</p>

      {composed && <p className={styles.muted} role="status">{composed}</p>}

      {problem && (
        <Alert tone="danger" title={problem.title}>
          {problem.text}
        </Alert>
      )}


      {channels.length === 0 ? (
        <EmptyState
          title="No channels in Buffer yet"
          description="Your posting times appear here once Buffer has a channel. Queue Pilot then fills the empty ones with drafts for you to approve."
          action={<a className={styles.connect} href={BUFFER_CHANNELS_URL} target="_blank" rel="noreferrer">Add a channel in Buffer <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" /></a>}
        />
      ) : (
      <div className={styles.layout}>
        <div className={styles.gridWrap}>
          <div className={styles.grid} role="table" aria-label="Posting slots for next week" style={{ gridTemplateColumns: `max-content ${DAYS.map((_, d) => (dayHasContent(d) ? "minmax(132px, 1fr)" : "56px")).join(" ")}` }}>
            <div className={styles.corner}>{week.timeZone && week.startsAt && <span className={styles.zone}>Times in {zoneLabel(week.timeZone, new Date(week.startsAt))}</span>}</div>
            {DAYS.map((d, i) => {
              const has = dayHasContent(i);
              return <div key={d} className={styles.day} data-empty={!has} role="columnheader">{has ? d : d.split(" ")[0]}</div>;
            })}
            {channels.map((ch) => (
              <div key={ch.id} className={styles.row} role="row">
                <div className={styles.channel} role="rowheader">
                  <span className={styles.chip}><ChannelIcon service={ch.service} />{ch.name}</span>
                  {ch.timezone && week.timeZone && week.startsAt && ch.timezone !== week.timeZone && (
                    <span className={styles.zone}>{zoneLabel(ch.timezone, new Date(week.startsAt))} times</span>
                  )}
                  {ch.isDisconnected && <>{" "}<Badge tone="danger" size="sm">Disconnected</Badge></>}
                </div>
                {DAYS.map((_, day) => {
                  return (
                    <div key={day} className={styles.cell} role="cell">
                      {entriesFor(ch.id, day)}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* On a phone the week reads as a list by day, each post labelled with its channel (the grid is hidden). */}
        <div className={styles.list} aria-label="Posting slots for next week, by day">
          {DAYS.map((d, day) => dayHasContent(day) && (
            <section key={d} className={styles.listDay} aria-label={d}>
              <h2 className={styles.listHead}>{d}</h2>
              {channels.map((ch) => {
                const items = entriesFor(ch.id, day);
                return items.length > 0 && (
                  <div key={ch.id} className={styles.listChannel}>
                    <span className={styles.chip}><ChannelIcon service={ch.service} />{ch.name}</span>
                    {ch.isDisconnected && <>{" "}<Badge tone="danger" size="sm">Disconnected</Badge></>}
                    {items}
                  </div>
                );
              })}
            </section>
          ))}
        </div>
      </div>
      )}

      <AccountsComposer open={newPostOpen} onClose={(saved) => { setNewPostOpen(false); if (saved) toast({ type: "success", title: saved }); }} />
      {/* A draft opens in a dialog over the week, the way a calendar opens an event; closing it returns focus to the draft. */}
      <SlotComposer slot={composing} live={live} onClose={(saved) => { setComposing(null); if (saved) toast({ type: "success", title: saved }); }} />
      <Dialog open={dialogOpen && current !== undefined} onOpenChange={setDialogOpen}>
        {current && (
        <DialogContent
          className={styles.dialog}
          onCloseAutoFocus={(e) => { e.preventDefault(); opener.current?.focus(); }}
          title={`${channels.find((c) => c.id === current.channel)?.name ?? ""}, ${DAYS[current.day]} at ${current.time}`}
          description={approved.has(current.id) ? STATE_WORD.scheduled : current.editedFrom && worstTone(current) === "success" ? "You edited this draft" : `${STATE_WORD[postState(current)]}${current.source ? `, from your ${SOURCE_SHORT[current.source.kind].toLowerCase()}` : ""}`}
        >
        <div className={styles.panel}>
          <div className={styles.panelMain}>
          {/* The post first, with Edit beside it; editing turns this same spot into the editor. */}
          {editing === null && (
            <>
              <div className={styles.postHead}>
                <h3 className={styles.h3}>Post</h3>
                {current.ours !== false && !approved.has(current.id) && (
                  <Button variant="secondary" size="sm" onClick={() => { setEditing(current.text); setConfirmDelete(false); setNote(null); }}><Pencil size={14} strokeWidth={1.75} aria-hidden="true" />Edit</Button>
                )}
              </div>
              <p className={styles.postText}>{current.text}</p>
              {(live || tagsPreview?.[current.id]) && <DraftTags key={`tags-${current.id}`} postId={current.id} preview={tagsPreview?.[current.id]} />}
              {current.createdAt && <p className={styles.muted}>{createdLine(current.createdAt, current.createdBy ?? null)}</p>}
            </>
          )}
          {editing !== null && (
            <div className={styles.editInPlace}>
              <Textarea label="Draft text" autoFocus value={editing} onChange={(e) => setEditing(e.target.value)} rows={6} />
              <div className={styles.actions}>
                <Button variant="primary" size="sm" disabled={busy || !editing.trim() || editing.trim() === current.text} onClick={() => run(async () => {
                  if (!live) { setEdited((m) => ({ ...m, [current.id]: editing.trim() })); return { ok: true as const }; }
                  return editDraftText(current.id, editing, current.text);
                }, live ? "Saved in Buffer. It is still a draft." : "Changed on this example page only.")}>{busy ? "Checking and saving…" : "Save"}</Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            </div>
          )}
          {current.editedFrom && (
            <div className={styles.sourceBox}>
              <div>
                <strong>You changed it</strong>
                <p className={styles.muted}><del><span className="sr-only">Before: </span>{current.editedFrom}</del></p>
              </div>
            </div>
          )}
          {(() => {
            const cards = evidence.filter(e => e.postId === current.id);
            if (cards.length) return <DraftSources cards={cards} live={live} />;
            return current.source && (
              <div className={styles.sourceBox}>
                <div>
                  <strong>{`${current.source.foundBy}: ${current.source.label}`}</strong>
                  <p className={styles.muted}>{current.source.detail}</p>
                </div>
              </div>
            );
          })()}
          </div>
          <div className={styles.panelSide}>
          <section className={styles.checks} aria-labelledby="draft-checks">
            <h3 id="draft-checks" className={styles.h3}>Checks</h3>
            {(() => {
              const v = verdicts[current.id];
              if (v === undefined) return null;
              // A live draft already carries this as a Check row below; saying it here too repeated it.
              if (v === null) return live && current.status === "draft" ? null : <p className={styles.muted}>{checkNotes[current.id] ?? "No current playbook check is available for this draft."}</p>;
              const passed = v.filter(r => r.verdict === "pass");
              const problems = v.filter(r => r.verdict !== "pass");
              const row = (r: (typeof v)[number]) => (
                <div key={r.ruleId} className={styles.check}>
                  <Badge tone={RESULT_TONE[r.verdict]} size="sm">{RESULT_LABEL[r.verdict]}</Badge>
                  <span>{r.rule}{r.quote ? ` Found "${r.quote}".` : ""}{r.verdict !== "pass" && r.reason ? ` ${r.reason}` : ""}{originOf(r.ruleId) && <span className={styles.ruleWhy}>{` Came from: ${originOf(r.ruleId)}.`}</span>}</span>
                </div>
              );
              return <>
                {/* A rule the draft breaks always shows in full; the ones it follows fold into one line. */}
                {problems.map(row)}
                {v.length === 0 && <p className={styles.muted}>No playbook rules yet. <a className={styles.rulesLink} href="/playbook">Open your playbook</a></p>}
                {passed.length > 0 && (
                  <details className={styles.ruleSummary}>
                    <summary><CircleCheck size={16} strokeWidth={1.75} aria-hidden="true" className={styles.passIcon} /><span>{`${passed.length} playbook rule${passed.length === 1 ? "" : "s"} ${problems.length ? "followed" : "passed"}`}</span><span className={styles.viewRules}>View rules</span></summary>
                    {passed.map(row)}
                    <a className={styles.rulesLink} href="/playbook">Open your playbook</a>
                  </details>
                )}
                {!live && <p className={styles.muted}>Example verdicts.</p>}
              </>;
            })()}
            {/* A broken rule already shows above as its own failed row, so its readiness row would say the same thing twice. */}
            {current.checks?.filter((c) => !(readiness[current.id]?.state === "breaks" && c.label === readiness[current.id]?.reason && verdicts[current.id]?.some((r) => r.verdict === "fail"))).map((c) => (
              <div key={c.label} className={styles.check}>
                <Badge tone={c.tone} size="sm">{c.tone === "success" ? "OK" : c.tone === "warning" ? "Check" : "Will fail"}</Badge>
                <span>{c.label}</span>
              </div>
            ))}
            {rules.length > 0 && (() => {
              const network = channels.find(c => c.id === current.channel)?.service ?? "";
              const lines = rulesForAccount(rules, network, current.channel);
              const on = lines.filter(l => l.applies).length;
              return lines.length > 0 && <details className={styles.ruleSummary}>
                <summary><span>{`${on} rule${on === 1 ? "" : "s"} set for this account`}</span><span className={styles.viewRules}>View</span></summary>
                <p className={styles.muted}>Your current settings. The check above shows how this draft did when it was last checked.</p>
                <ul className={styles.ruleLines}>
                  {lines.map(l => <li key={l.rule.id} data-off={!l.applies}>
                    <span className={styles.ruleText}>{l.rule.text}</span>
                    <span className={styles.ruleWhy}>{l.from} · {l.why}{originOf(l.rule.id) ? ` · ${originOf(l.rule.id)}` : ""}</span>
                  </li>)}
                </ul>
              </details>;
            })()}
          </section>
          {(live || notesPreview?.[current.id]) && <DraftNotes key={current.id} postId={current.id} preview={notesPreview?.[current.id]} />}
          </div>
        </div>
        {/* The decision stays in view: a fixed bar at the bottom of the window, as Buffer keeps a post's actions in one row. */}
        <div className={styles.footer}>
          {confirmDelete ? (
            <>
              <p className={styles.footNote}>Delete this draft from Buffer? The time becomes empty again.</p>
              <div className={styles.actions}>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep it</Button>
                <Button variant="danger" size="sm" disabled={busy} onClick={() => run(async () => {
                  if (!live) { setGone((s) => new Set(s).add(current.id)); return { ok: true as const }; }
                  return deleteMyDraft(current.id);
                }, live ? "Draft deleted from Buffer. Its time is empty again." : "Removed on this example page only.", true)}>{busy ? "Deleting…" : "Delete draft"}</Button>
              </div>
            </>
          ) : (
            <>
              {note ? <p className={styles.footNote} role={note.ok ? "status" : "alert"}>{note.text}</p>
                : current.ours === false ? <p id="approve-foreign" className={styles.footNote}>Queue Pilot did not write this draft. Change or schedule it in Buffer.</p>
                : approved.has(current.id) ? <p className={styles.footNote}>{`Scheduled in Buffer. ${approverLine(APPROVED_IN_APP, new Date().toISOString())}${live ? "" : " (example)"}.`}</p>
                : needsCheck(current.id) ? <p id="approve-playbook" className={styles.footNote}>{approveOffNote(readiness[current.id])}</p>
                : worstTone(current) === "danger" ? <p id="approve-off" className={styles.footNote}>This post would fail in Buffer, so it cannot be approved yet. Fix the problem and Approve turns on.</p>
                : <p className={styles.footNote}>Saved as a draft in Buffer.</p>}
              <div className={styles.actions}>
                {current.ours !== false && !approved.has(current.id) && live && (verdicts[current.id] === null || needsCheck(current.id)) && <Button variant="secondary" disabled={busy} onClick={() => run(() => recheckMyDrafts([current.id]).then((r) => (r.ok ? { ok: true as const } : r)), "Checked against your playbook.")}>Check again</Button>}
                {current.ours !== false && !approved.has(current.id) && (
                  <DropdownMenu label="More" icon={<MoreHorizontal size={16} strokeWidth={1.75} />} items={[{ label: "Delete draft", destructive: true, icon: <Trash2 size={15} strokeWidth={1.75} />, onSelect: () => { setConfirmDelete(true); setEditing(null); setNote(null); } }]} />
                )}
                <Button variant="primary" disabled={current.ours === false || worstTone(current) === "danger" || needsCheck(current.id) || approved.has(current.id) || pending} aria-describedby={current.ours === false ? "approve-foreign" : needsCheck(current.id) ? "approve-playbook" : worstTone(current) === "danger" && !approved.has(current.id) ? "approve-off" : undefined} onClick={() => approve([current.id])}>
                  {approved.has(current.id) ? "Approved" : "Approve & schedule"}
                </Button>
              </div>
            </>
          )}
        </div>
        </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
