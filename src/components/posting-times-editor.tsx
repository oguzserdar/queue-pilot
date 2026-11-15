"use client";

/**
 * Posting times for one directly connected account: a row per weekday with its times as chips, a time picker to add
 * one, and the time zone the times are in (the browser's, until the person has saved one). Saving replaces the
 * whole week, the same way a Buffer posting schedule is edited.
 */
import { useState, useTransition } from "react";
import { Button } from "@/registry/components/button/button";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { TimePicker } from "@/registry/components/time-picker/time-picker";
import { setPostingTimesAction } from "@/app/(app)/social-actions";
import styles from "./posting-times-editor.module.css";

const DAYS = [["mon", "Monday"], ["tue", "Tuesday"], ["wed", "Wednesday"], ["thu", "Thursday"], ["fri", "Friday"], ["sat", "Saturday"], ["sun", "Sunday"]] as const;
type Week = Record<string, string[]>;

/** How many posting times a saved week holds, for the row's button. */
export const timesCount = (schedule: { times: string[] }[]) => schedule.reduce((n, d) => n + d.times.length, 0);

export function PostingTimesEditor({ accountId, handle, schedule, timeZone, disabled, onSaved }: {
  accountId: string; handle: string; schedule: { day: string; times: string[] }[]; timeZone: string | null; disabled?: boolean;
  onSaved: (r: { ok: boolean; message: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [week, setWeek] = useState<Week>({});
  const [adding, setAdding] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const zone = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const count = timesCount(schedule);

  const openEditor = () => {
    setWeek(Object.fromEntries(schedule.map((d) => [d.day, [...d.times]])));
    setProblem(null);
    setOpen(true);
  };
  const add = (day: string) => setWeek((w) => ({ ...w, [day]: [...new Set([...(w[day] ?? []), adding[day] ?? "09:00"])].sort() }));
  const remove = (day: string, t: string) => setWeek((w) => ({ ...w, [day]: (w[day] ?? []).filter((x) => x !== t) }));
  const copyToWeekdays = (day: string) => setWeek((w) => ({ ...w, ...Object.fromEntries(DAYS.slice(0, 5).map(([d]) => [d, [...(w[day] ?? [])]])) }));
  const save = () =>
    start(async () => {
      const r = await setPostingTimesAction(accountId, DAYS.map(([d]) => ({ day: d, times: week[d] ?? [] })), zone)
        .catch(() => ({ ok: false, message: "Queue Pilot did not answer. Try again." }));
      if (!r.ok) { setProblem(r.message); return; }
      setOpen(false);
      onSaved(r);
    });

  return (
    <>
      <Button variant="secondary" size="sm" disabled={disabled} onClick={openEditor}>{count ? `Posting times (${count})` : "Set posting times"}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className={styles.dialog} title={`Posting times for ${handle}`} description={`Queue Pilot plans posts for ${handle} at these times, and they show as open times in Next week. Times are in ${zone}.`}>
          <div className={styles.days}>
            {DAYS.map(([day, name]) => (
              <div key={day} className={styles.day}>
                <span className={styles.dayName}>{name}</span>
                <div className={styles.times}>
                  {(week[day] ?? []).length === 0 && <span className={styles.none}>No times</span>}
                  {(week[day] ?? []).map((t) => (
                    <button key={t} type="button" className={styles.time} aria-label={`Remove ${t} on ${name}`} onClick={() => remove(day, t)}>{t} <span aria-hidden="true">×</span></button>
                  ))}
                </div>
                <div className={styles.add}>
                  <TimePicker label={`Time to add on ${name}`} className={styles.picker} value={adding[day] ?? "09:00"} onChange={(t) => setAdding((a) => ({ ...a, [day]: t }))} minuteStep={5} format="24h" />
                  <Button variant="secondary" size="sm" onClick={() => add(day)}>Add</Button>
                  {day === "mon" && (week.mon ?? []).length > 0 && <Button variant="ghost" size="sm" onClick={() => copyToWeekdays("mon")}>Same on weekdays</Button>}
                </div>
              </div>
            ))}
          </div>
          {problem && <p className={styles.problem} role="alert">{problem}</p>}
          <div className={styles.foot}>
            <Button variant="secondary" size="md" onClick={() => setOpen(false)}>Cancel</Button>
            <Button variant="primary" size="md" loading={pending} onClick={save}>Save times</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
