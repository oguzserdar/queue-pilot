import week from "./week-view.module.css";
import sk from "./skeleton.module.css";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
/** Which cells hold a post placeholder and which an empty time, so the calendar reads as a week, not a grid of bars. */
const PATTERN = [[1, 2, 0, 1, 0, 0, 0], [1, 0, 1, 0, 2, 0, 0], [0, 1, 0, 0, 1, 0, 0]];

/** Next week while Buffer is read: the calendar's own frame with placeholder posts in their slots. */
export function WeekSkeleton() {
  return (
    <div className={week.page} aria-busy="true" aria-label="Loading next week">
      <header className={week.head}>
        <div><h1 className={week.title}>Next week</h1><span className={sk.bar} style={{ width: 220, marginTop: 12 }} /></div>
      </header>
      <div className={week.gridWrap}>
        <div className={week.grid} style={{ gridTemplateColumns: `max-content repeat(7, minmax(96px, 1fr))` }}>
          <div className={week.corner} />
          {DAYS.map((d) => <div key={d} className={week.day}>{d}</div>)}
          {PATTERN.map((row, r) => (
            <div key={r} className={week.row}>
              <div className={week.channel}><span className={sk.bar} style={{ width: 110 }} /></div>
              {row.map((kind, d) => (
                <div key={d} className={week.cell}>
                  {kind === 1 && <div className={sk.post}><span className={sk.bar} style={{ width: "40%" }} /><span className={sk.bar} /><span className={sk.bar} style={{ width: "70%" }} /></div>}
                  {kind === 2 && <div className={sk.slot} />}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Needs you while Buffer is read: the title and rows of the list it will show. */
export function NeedsSkeleton() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24, maxWidth: 860 }} aria-busy="true" aria-label="Loading what needs you">
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}><span className={sk.bar} style={{ width: 180 }} /><span className={sk.bar} style={{ width: 260, height: 22 }} /></div>
      <ul className={sk.rows}>
        {[0, 1, 2, 3].map((i) => (
          <li key={i} className={sk.row}><span className={sk.dot} /><span className={sk.lines}><span className={sk.bar} style={{ width: `${70 - i * 8}%` }} /><span className={sk.bar} style={{ width: "40%", height: 8 }} /></span><span className={sk.bar} style={{ height: 28, borderRadius: 7 }} /></li>
        ))}
      </ul>
    </div>
  );
}
