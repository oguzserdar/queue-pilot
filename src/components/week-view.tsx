"use client";

import { BUFFER_CHANNELS_URL } from "@/lib/connect-links";
import { ArrowUpRight } from "lucide-react";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveDrafts, deleteMyDraft, editDraftText } from "@/app/(app)/actions";
import { Textarea } from "@/registry/components/textarea/textarea";
import { Button } from "@/registry/components/button/button";
import { Badge } from "@/registry/components/badge/badge";
import { Alert } from "@/registry/components/alert/alert";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { rulesForAccount } from "@/lib/rule-explain";
import type { Rule } from "@/lib/rules";
import type { Verdict } from "@/lib/judge";
import { EXAMPLE_VERDICTS } from "@/lib/example-verdicts";
import { WriteWeekButton } from "./write-week-button";
import { ShareReviewButton } from "./share-review-button";
import type { WritingAvailability } from "@/lib/writing-availability";
import { ChannelIcon } from "./channel-icon";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { NEW_POST_EVENT, PAGE_ACTION_EVENT } from "./keyboard-shortcuts";
import { SlotComposer, type ComposerSlot } from "./slot-composer";
import { cellEntries, countOpenSlots, firstEmptySlot, slotKey, worstTone, zoneLabel, type WeekModel, type WeekPost as Post } from "@/lib/week-model";
import { isTypingTarget } from "@/lib/shortcuts";
import { postState, STATE_WORD } from "@/lib/post-state";
import { StateMark } from "./state-mark";
import styles from "./week-view.module.css";

const FULL_DAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];


const RESULT_LABEL = { pass: "Follows", fail: "Breaks", unsure: "Not sure" } as const;
const RESULT_TONE = { pass: "success", fail: "danger", unsure: "warning" } as const;

/**
 * `live` is true for a signed-in user: Approve schedules the drafts in Buffer. Example data only marks them on screen.
 * `verdicts` are the playbook verdicts each draft was saved with, by post id; null means it was saved unchecked.
 */
export function WeekView({ week, live = false, verdicts = live ? {} : EXAMPLE_VERDICTS, writing, writeCount = 0, rules = [], checkNotes = {} }: { week: WeekModel; rules?: Rule[]; checkNotes?: Record<string, string>; live?: boolean; verdicts?: Record<string, Verdict[] | null>; writing?: WritingAvailability; writeCount?: number }) {
  const { label: WEEK_LABEL, days: DAYS, channels, slots } = week;
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
    checks: live && p.status === "draft" && verdicts[p.id] === null
      ? [...(p.checks ?? []), { tone: "warning" as const, label: checkNotes[p.id] ?? "Needs a current playbook check." }]
      : p.checks,
    // Live verdict entries come from this person's writing records, including drafts saved unchecked.
    ours: live ? Object.hasOwn(verdicts, p.id) : p.ours,
  }));
  const drafts = posts.filter((p) => p.status === "draft");
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | undefined>();
  // The draft stays selected while the dialog closes, so its content can animate out and focus can return to the draft that opened it.
  const [dialogOpen, setDialogOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const current = posts.find((p) => p.id === selected);
  const open = countOpenSlots({ ...week, posts });
  const ready = drafts.filter((p) => p.ours !== false && worstTone(p) !== "danger" && !approved.has(p.id));
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
      if (res.approved.length) toast({ type: "success", title: `${res.approved.length} post${res.approved.length === 1 ? "" : "s"} scheduled in Buffer` });
      if (res.refused.length) setProblem({ title: `${res.refused.length} draft${res.refused.length === 1 ? " was" : "s were"} not scheduled`, text: res.refused.map((r) => r.reason).join(" ") });
    });
  };

  // Wide screens keep the week in view with the open post beside it; narrower ones open the post over the week.
  const wide = useWide();
  const openPost = (id: string, el: HTMLElement | null) => {
    opener.current = el;
    setSelected(id);
    setEditing(null);
    setConfirmDelete(false);
    setNote(null);
    if (!wide) setDialogOpen(true);
  };
  // On a wide screen the first draft is already open, the way a mail app opens the top message.
  useEffect(() => {
    if (wide && !selected && drafts[0]) setSelected(drafts[0].id);
  }, [wide, selected, drafts]);

  /** One day as a list: every channel's slots and posts in time order, one line each. */
  const dayRows = (day: number) =>
    channels
      .flatMap((ch) => cellEntries({ ...week, posts }, ch.id, day).flatMap((e) => (e.posts.length ? e.posts.map((p) => ({ time: e.time, ch, post: p as Post | null })) : e.slot ? [{ time: e.time, ch, post: null }] : [])))
      .sort((a, b) => mins(a.time) - mins(b.time));
  const order = DAYS.flatMap((_, d) => dayRows(d).filter((r) => r.post?.status === "draft").map((r) => r.post!.id));
  const canApprove = (p: Post) => p.ours !== false && worstTone(p) !== "danger" && !approved.has(p.id);

  // J and K move through the drafts, A approves the open one, E edits it. Never while typing or in a dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(document.activeElement) || document.querySelector('[role="dialog"]')) return;
      const k = e.key.toLowerCase();
      const at = selected ? order.indexOf(selected) : -1;
      if (k === "j" || k === "k") {
        const next = order[Math.min(order.length - 1, Math.max(0, at + (k === "j" ? 1 : -1)))];
        if (!next) return;
        e.preventDefault();
        setSelected(next);
        setEditing(null);
        setConfirmDelete(false);
        setNote(null);
        document.getElementById(`post-${next}`)?.scrollIntoView({ block: "nearest" });
        if (!wide) document.getElementById(`post-${next}`)?.focus();
      } else if (k === "enter" && current && !wide && document.activeElement?.id !== `post-${current.id}`) {
        e.preventDefault();
        setDialogOpen(true);
      } else if (k === "a" && current?.status === "draft" && canApprove(current) && !pending) {
        e.preventDefault();
        approve([current.id]);
      } else if (k === "e" && current?.status === "draft" && current.ours !== false && !approved.has(current.id)) {
        e.preventDefault();
        setEditing(current.text);
        if (!wide) setDialogOpen(true);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

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

  /** One cell's slots and posts, shared by the calendar and the phone day list. */
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
        const state = postState(p, approved.has(p.id));
        if (p.status !== "draft") return (
          <div key={p.id} className={styles.existing} data-status={p.status}>
            <span className={styles.time}>{t}<span className={styles.state}><StateMark state={state} word /></span></span>
            <span className={styles.text}>{p.text}</span>
            {p.status === "error" && <span className={styles.reason}>{p.error?.message || "Buffer did not say why."} This time counts as open again.</span>}
          </div>
        );
        return (
          <button key={p.id} id={`post-${p.id}`} type="button" onClick={(e) => openPost(p.id, e.currentTarget)} className={styles.draft} data-tone={worstTone(p)} data-selected={selected === p.id && (wide || dialogOpen)} data-approved={approved.has(p.id)} aria-current={selected === p.id ? "true" : undefined}>
            <span className={styles.time}>{t}<span className={styles.state}><StateMark state={state} word /></span></span>
            <span className={styles.text}>{p.text}</span>
          </button>
        );
      });
    });

  const filled = (() => { let all = 0; for (const ch of channels) for (const t of Object.values(slots[ch.id] ?? {})) all += t.length; return { all, done: all - open }; })();
  const needYou = drafts.filter((p) => p.ours !== false && !approved.has(p.id)).length;

  /** The open post: its text, checks, rules and actions. Shown beside the week, or in a dialog on narrower screens. */
  const detail = (current: Post) => (
        <div className={styles.panel} data-inline={wide || undefined}>
          <div className={styles.panelMain}>
          <p className={styles.postText}>{current.text}</p>
          {current.editedFrom && (
            <div className={styles.sourceBox}>
              <div>
                <strong>You changed it</strong>
                <p className={styles.muted}><del><span className="sr-only">Before: </span>{current.editedFrom}</del></p>
              </div>
            </div>
          )}
          <div className={styles.sourceBox}>
            <div>
              <strong>{current.source ? `${current.source.foundBy}: ${current.source.label}` : "Saved in Buffer as a draft"}</strong>
              <p className={styles.muted}>{current.source?.detail}</p>
            </div>
          </div>
          </div>
          <div className={styles.panelSide}>
          <div className={styles.actions}>
            <Button variant="primary" disabled={!canApprove(current) || pending} aria-describedby={current.ours === false ? "approve-foreign" : worstTone(current) === "danger" && !approved.has(current.id) ? "approve-off" : undefined} onClick={() => approve([current.id])}>
              {approved.has(current.id) ? "Approved" : "Approve"}{canApprove(current) && <kbd className={styles.key}>A</kbd>}
            </Button>
            {current.ours !== false && !approved.has(current.id) && (
              <>
                <Button variant="secondary" onClick={() => { setEditing(current.text); setConfirmDelete(false); setNote(null); }}>Edit<kbd className={styles.key}>E</kbd></Button>
                <Button variant="ghost" onClick={() => { setConfirmDelete(true); setEditing(null); setNote(null); }}>Delete draft</Button>
              </>
            )}
          </div>
          {worstTone(current) === "danger" && !approved.has(current.id) && (
            <p id="approve-off" className={styles.muted}>This post would fail in Buffer, so it cannot be approved yet. Fix the problem and Approve turns on.</p>
          )}
          {current.ours === false && <p id="approve-foreign" className={styles.muted}>Queue Pilot did not write this draft. Change or schedule it in Buffer.</p>}
          {editing !== null && (
            <div className={styles.editor}>
              <Textarea label="Draft text" value={editing} onChange={(e) => setEditing(e.target.value)} rows={4} autoFocus />
              <div className={styles.actions}>
                <Button variant="primary" size="sm" disabled={busy || !editing.trim() || editing.trim() === current.text} onClick={() => run(async () => {
                  if (!live) { setEdited((m) => ({ ...m, [current.id]: editing.trim() })); return { ok: true as const }; }
                  return editDraftText(current.id, editing, current.text);
                }, live ? "Saved in Buffer. It is still a draft." : "Changed on this example page only.")}>{busy ? "Checking and saving…" : "Save"}</Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(null)}>Cancel</Button>
              </div>
            </div>
          )}
          {confirmDelete && (
            <div className={styles.editor}>
              <p className={styles.muted}>Delete this draft from Buffer? The time becomes empty again.</p>
              <div className={styles.actions}>
                <Button variant="danger" size="sm" disabled={busy} onClick={() => run(async () => {
                  if (!live) { setGone((s) => new Set(s).add(current.id)); return { ok: true as const }; }
                  return deleteMyDraft(current.id);
                }, live ? "Draft deleted from Buffer. Its time is empty again." : "Removed on this example page only.", true)}>{busy ? "Deleting…" : "Delete draft"}</Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirmDelete(false)}>Keep it</Button>
              </div>
            </div>
          )}
          {note && <p className={styles.muted} role={note.ok ? "status" : "alert"}>{note.text}</p>}
          <div className={styles.checks}>
            <h3 className={styles.h3}>Before it goes out</h3>
            {current.checks?.map((c) => (
              <div key={c.label} className={styles.check}>
                <Badge tone={c.tone} size="sm">{c.tone === "success" ? "OK" : c.tone === "warning" ? "Check" : "Will fail"}</Badge>
                <span>{c.label}</span>
              </div>
            ))}
          </div>
          {(() => {
            const v = verdicts[current.id];
            // An unchecked draft already says so under "Before it goes out".
            if (v === undefined || v === null) return null;
            return (
              <div className={styles.checks}>
                <h3 className={styles.h3}>Your playbook</h3>
                {v === null ? (
                  <p className={styles.muted}>{checkNotes[current.id] ?? "No current playbook check is available for this draft."}</p>
                ) : (
                  v.map((r) => (
                    <div key={r.ruleId} className={styles.check}>
                      <Badge tone={RESULT_TONE[r.verdict]} size="sm">{RESULT_LABEL[r.verdict]}</Badge>
                      <span>{r.rule}{r.quote ? ` Found "${r.quote}".` : ""}{r.verdict !== "pass" && r.reason ? ` ${r.reason}` : ""}</span>
                    </div>
                  ))
                )}
                {!live && <p className={styles.muted}>Example verdicts.</p>}
              </div>
            );
          })()}
          {live && rules.length > 0 && (() => {
            const network = channels.find(c => c.id === current.channel)?.service ?? "";
            const lines = rulesForAccount(rules, network, current.channel);
            const on = lines.filter(l => l.applies).length;
            return lines.length > 0 && <details className={styles.checks}>
              <summary className={styles.h3}>{`${on} rule${on === 1 ? "" : "s"} for this account`}</summary>
              <p className={styles.muted}>Your current settings. The check above shows how this draft did when it was last checked.</p>
              <ul className={styles.ruleLines}>
                {lines.map(l => <li key={l.rule.id} data-off={!l.applies}>
                  <span className={styles.ruleText}>{l.rule.text}</span>
                  <span className={styles.ruleWhy}>{l.from} · {l.why}</span>
                </li>)}
              </ul>
              <a className={styles.rulesLink} href="/playbook">Open your playbook</a>
            </details>;
          })()}
          </div>
        </div>
  );
  const titleOf = (p: Post) => `${channels.find((c) => c.id === p.channel)?.name ?? ""} · ${FULL_DAY[p.day].slice(0, 3)} ${p.time}`;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <div>
          <h1 className={styles.title}>Next week</h1>
          <p className={styles.sub}>
            <span className="tnum">{WEEK_LABEL}</span>
            {channels.length > 0 && filled.all > 0 && (
              <span className={styles.capacity}>
                <span className={styles.meter} role="img" aria-label={`${filled.done} of ${filled.all} slots have a post`}><i style={{ width: `${(filled.done / filled.all) * 100}%` }} /></span>
                <span className="tnum">{filled.done} of {filled.all} filled</span>
                {needYou > 0 && <span className={styles.needCount}>· {needYou} need{needYou === 1 ? "s" : ""} you</span>}
              </span>
            )}
          </p>
        </div>
        <div className={styles.headActions}>
          {live && open > 0 && writing && <WriteWeekButton availability={writing} count={writeCount} inlineActions />}
          {live && drafts.length > 0 && <ShareReviewButton openSignal={shareSignal} drafts={drafts.map((d) => ({ id: d.id, label: `${channels.find((c) => c.id === d.channel)?.name ?? ""}, ${FULL_DAY[d.day]} at ${d.time}`, text: d.text }))} />}
          {drafts.length > 0 && (
            confirmAll ? (
              <>
                <Button variant="ghost" autoFocus onClick={() => setConfirmAll(false)}>Cancel</Button>
                <Button variant="primary" onClick={() => { setConfirmAll(false); approve(ready.map((p) => p.id)); }}>
                  {`Schedule ${ready.length} post${ready.length === 1 ? "" : "s"} in Buffer`}
                </Button>
              </>
            ) : (
              <Button variant="primary" disabled={ready.length === 0 || pending} onClick={() => setConfirmAll(true)}>
                {pending ? "Approving…" : ready.length > 0 ? `Approve ${ready.length} draft${ready.length === 1 ? "" : "s"}` : waiting > 0 || !approved.size ? "Nothing ready to approve" : "All approved"}
              </Button>
            )
          )}
        </div>
      </header>

      {composed && <p className={styles.muted} role="status">{composed}</p>}
      {problem && <Alert tone="danger" title={problem.title}>{problem.text}</Alert>}

      {channels.length === 0 ? (
        <EmptyState
          title="No channels in Buffer yet"
          description="Your posting times appear here once Buffer has a channel. Queue Pilot then fills the empty ones with drafts for you to approve."
          action={<a className={styles.connect} href={BUFFER_CHANNELS_URL} target="_blank" rel="noreferrer">Add a channel in Buffer <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" /></a>}
        />
      ) : (
      <div className={styles.layout} data-side={wide && current ? "true" : undefined}>
        <div className={styles.weekArea}>
          <div className={styles.gridWrap}>
            <div className={styles.grid} role="table" aria-label="Posting slots for next week" style={{ gridTemplateColumns: `max-content ${DAYS.map((_, d) => (dayRows(d).length ? "minmax(132px, 1fr)" : "40px")).join(" ")}` }}>
              <div className={styles.corner}>{week.timeZone && week.startsAt && <span className={styles.zone}>Times in {zoneLabel(week.timeZone, new Date(week.startsAt))}</span>}</div>
              {DAYS.map((d, i) => {
                const has = dayRows(i).length > 0;
                return <div key={d} className={styles.day} data-empty={!has} role="columnheader">{has ? d : d.split(" ")[0]}</div>;
              })}
              {channels.map((ch) => (
                <div key={ch.id} className={styles.row} role="row">
                  <div className={styles.channel} role="rowheader">
                    <span className={styles.chip}><ChannelIcon service={ch.service} />{ch.name}</span>
                    {ch.timezone && week.timeZone && week.startsAt && ch.timezone !== week.timeZone && <span className={styles.zone}>{zoneLabel(ch.timezone, new Date(week.startsAt))} times</span>}
                    {ch.isDisconnected && <>{" "}<Badge tone="danger" size="sm">Disconnected</Badge></>}
                  </div>
                  {DAYS.map((_, day) => <div key={day} className={styles.cell} role="cell">{entriesFor(ch.id, day)}</div>)}
                </div>
              ))}
            </div>
          </div>

          {/* On a phone, or when the area is narrow, the week reads as a list by day (the grid is hidden). */}
          <div className={styles.list} aria-label="Posting slots for next week, by day">
            {DAYS.map((d, day) => dayRows(day).length > 0 && (
              <section key={d} className={styles.listDay} aria-label={d}>
                <h2 className={styles.listHead}>{d}</h2>
                {channels.map((ch) => {
                  const items = entriesFor(ch.id, day);
                  return items.length > 0 && (
                    <div key={ch.id} className={styles.listChannel}>
                      <span className={styles.chip}><ChannelIcon service={ch.service} />{ch.name}</span>
                      {items}
                    </div>
                  );
                })}
              </section>
            ))}
          </div>
          <p className={styles.hint}><kbd className={styles.key}>J</kbd> <kbd className={styles.key}>K</kbd> move · <kbd className={styles.key}>A</kbd> approve · <kbd className={styles.key}>E</kbd> edit · Queue Pilot never schedules or publishes on its own. Only your Approve schedules, or your AI when you ask it.</p>
        </div>

        {wide && current && (
          <aside className={styles.side} aria-label="Open post">
            <header className={styles.sideHead}>
              <div>
                <h2 className={styles.sideTitle}>{titleOf(current)}</h2>
                <StateMark state={postState(current, approved.has(current.id))} word />
              </div>
              <Button variant="ghost" size="sm" onClick={() => setSelected(undefined)}>Close</Button>
            </header>
            {detail(current)}
          </aside>
        )}
      </div>
      )}

      <SlotComposer slot={composing} live={live} onClose={(saved) => { setComposing(null); if (saved) toast({ type: "success", title: saved }); }} />
      <Dialog open={!wide && dialogOpen && current !== undefined} onOpenChange={setDialogOpen}>
        {current && (
        <DialogContent
          className={styles.dialog}
          onCloseAutoFocus={(e) => { e.preventDefault(); opener.current?.focus(); }}
          title={titleOf(current)}
          description={STATE_WORD[postState(current, approved.has(current.id))]}
        >
          {detail(current)}
        </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

/** True when the window is wide enough to show the open post beside the week. */
function useWide() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const q = window.matchMedia("(min-width: 1180px)");
    const set = () => setWide(q.matches);
    set();
    q.addEventListener("change", set);
    return () => q.removeEventListener("change", set);
  }, []);
  return wide;
}

const mins = (t: string) => { const [h, m] = t.split(":").map(Number); return h * 60 + m; };
