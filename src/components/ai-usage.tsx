import styles from "./ai-usage.module.css";

/** Dollars with cents, the way a budget is read. */
const usd = (n: number) => `$${n.toFixed(2)}`;

/** A gauge of what is left, like a fuel gauge: full at the start, empty when nothing is left. */
function Gauge({ label, value, unit, left, total, note }: { label: string; value: string; unit: string; left: number; total: number; note: string }) {
  const pct = total > 0 ? Math.max(0, Math.min(100, (left / total) * 100)) : 0;
  return (
    <div className={styles.gauge}>
      <div className={styles.label}>{label}</div>
      <div className={styles.big}>{value} <span className={styles.unit}>{unit}</span></div>
      <div className={styles.bar} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={total} aria-valuenow={left}><i className={styles.fill} style={{ width: `${pct}%` }} /></div>
      <div className={styles.note}>{note}</div>
    </div>
  );
}

/**
 * Built-in AI usage, the same block on Settings (one person) and /admin (everyone): what is left today and what is
 * left of the shared budget. Numbers are live text, never part of a picture.
 */
export function AiUsage(props:
  | { view: "person"; used: number; cap: number; budgetUsd: number; leftUsd: number; resetsAt: string }
  | { view: "operator"; today: number; totalCap: number | null; perPerson: number; budgetUsd: number; leftUsd: number; resetsAt: string }) {
  const budget = <Gauge label="Shared budget" value={usd(props.leftUsd)} unit={`of ${usd(props.budgetUsd)} left`} left={props.leftUsd} total={props.budgetUsd}
    note={props.view === "person" ? "For everyone on this copy. When it runs out, built-in AI stops." : `Spent so far: ${usd(props.budgetUsd - props.leftUsd)}. When it runs out, built-in AI stops for everyone.`} />;
  return (
    <div className={styles.meters}>
      {props.view === "person"
        ? <Gauge label="Your actions today" value={String(Math.max(0, props.cap - props.used))} unit={`of ${props.cap} left`} left={Math.max(0, props.cap - props.used)} total={props.cap} note={`Starts again at ${props.resetsAt} your time`} />
        : props.totalCap
          ? <Gauge label="Actions today, everyone" value={String(Math.max(0, props.totalCap - props.today))} unit={`of ${props.totalCap} left`} left={Math.max(0, props.totalCap - props.today)} total={props.totalCap} note={`${props.today} used. Each person can use ${props.perPerson} a day. Starts again at ${props.resetsAt}.`} />
          : <div className={styles.gauge}><div className={styles.label}>Actions today, everyone</div><div className={styles.big}>{props.today} <span className={styles.unit}>used</span></div><div className={styles.note}>No daily cap for everyone. Each person can use {props.perPerson} a day. Starts again at {props.resetsAt}.</div></div>}
      {budget}
    </div>
  );
}

/**
 * When the daily count starts again (midnight UTC), shown in the given zone, e.g. "03:00".
 *
 * @param timeZone - IANA zone the person sees times in
 */
export function resetTime(timeZone: string, now: Date = new Date()): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toLocaleTimeString("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" });
}
