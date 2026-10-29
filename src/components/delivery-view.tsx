"use client";

import { ArrowUpRight } from "lucide-react";

import type { DeliveryItem } from "@/lib/delivery-model";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import styles from "./delivery-view.module.css";

/** Formats in the channel's own timezone, so a 09:00 slot reads 09:00 wherever the server runs. */
const day = (d: DeliveryItem) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: d.timeZone ?? "UTC" }).format(new Date(d.at));
const time = (d: DeliveryItem) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: d.timeZone ?? "UTC" }).format(new Date(d.at));

/** Where a sent post was also copied, keyed by Buffer post id. */
export type CopyMarks = Record<string, { kind: "telegram" | "discord"; ok: boolean }[]>;

const COPY_NAME = { telegram: "Telegram", discord: "Discord" } as const;

export function DeliveryView({ deliveries, copies = {} }: { deliveries: DeliveryItem[]; copies?: CopyMarks }) {
  const open = deliveries.filter((d) => d.tone === "danger");
  const wentOut = deliveries.filter((d) => d.tone === "success").length;
  const failedCount = deliveries.filter((d) => d.tone === "danger").length;
  const late = deliveries.filter((d) => d.tone === "warning").length;

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>
          {deliveries.length === 0
            ? "Delivery"
            : open.length
              ? `${wentOut} of ${deliveries.length} posts went out last week. ${failedCount === 1 ? "One did not." : `${failedCount} did not.`}`
              : late
                ? `${wentOut} of ${deliveries.length} posts went out last week. ${late} ${late === 1 ? "is" : "are"} late.`
                : "Every post from last week is accounted for."}
        </h1>
        <p className={styles.sub}>After each slot, Queue Pilot asks Buffer whether the post went out, and shows Buffer's own reason when it did not. Checked each time Queue Pilot reads your Buffer account.</p>
      </header>

      {deliveries.length === 0 && (
        <EmptyState
          title="No posts were due last week"
          description="Once Buffer sends a post from your queue, this page shows whether it went out, and Buffer's own reason when it did not."
          action={<a className={styles.help} href="/week">Open next week</a>}
        />
      )}
      {deliveries.length > 0 && (
      <ol className={styles.ledger} aria-label="Last week's slots">
        {deliveries.map((d) => {
          const state = d.tone === "success" ? "sent" : d.tone === "warning" ? "late" : "failed";
          return (
            <li key={d.id} className={styles.slot} data-state={state}>
              <span className={styles.mark} aria-hidden="true" />
              <span className={styles.slotDay}>{day(d)}</span>
              <span className={styles.slotMeta}>{d.channel}, <span className="tnum">{time(d)}</span></span>
              <CopyLine marks={copies[d.id] ?? []} />
              <span className={styles.slotState}>{state === "sent" ? "Went out" : state === "late" ? "Late" : "Failed"}</span>
            </li>
          );
        })}
      </ol>
      )}

      {deliveries.filter((d) => d.tone === "danger").map((d) => {
        return "error" in d && d.error ? (
          <section key={d.id} className={styles.failure} aria-labelledby={`f-${d.id}`}>
            <div className={styles.failText}>
              <h2 id={`f-${d.id}`} className={styles.h2}>{d.title.replace(/^Failed: /, "")}</h2>
              <p className={styles.meta}>{d.channel}, {day(d)} at <span className="tnum">{time(d)}</span></p>
              <p className={styles.quote}><span className={styles.who}>Buffer's reason</span>{d.error.message}</p>
            </div>
            <div className={styles.failActions}>
              <a className={styles.help} href={d.error.supportUrl} target="_blank" rel="noreferrer">
                Buffer's help for this error <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" />
              </a>
            </div>
          </section>
        ) : null;
      })}
    </div>
  );
}

/** "Also on Telegram, Discord", plus a separate line for any copy that finally failed. */
function CopyLine({ marks }: { marks: CopyMarks[string] }) {
  const ok = marks.filter((m) => m.ok).map((m) => COPY_NAME[m.kind]);
  const bad = marks.filter((m) => !m.ok).map((m) => COPY_NAME[m.kind]);
  if (!ok.length && !bad.length) return null;
  return (
    <span className={styles.slotMeta}>
      {ok.length > 0 && <span className={styles.copyOk}>Also on {ok.join(", ")}</span>}
      {bad.length > 0 && <span className={styles.copyBad}>{ok.length ? ". " : ""}Copy to {bad.join(", ")} failed</span>}
    </span>
  );
}
