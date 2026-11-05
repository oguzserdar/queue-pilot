"use client";

/**
 * "New post" for several accounts, laid out the way schedulers lay it out: choose accounts above one main text, then a
 * tab per account that follows the main text until it is customized for that account. Each tab counts characters the
 * way Buffer counts them for that network, against that account's own limit. One Save button keeps the post in Buffer
 * and saves one draft per account, each checked against that account's rules; nothing is scheduled.
 */
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { readComposerAccounts, saveForAccounts, type ComposerAccount } from "@/app/(app)/accounts-actions";
import { countFor } from "@/lib/char-limits";
import { placeholdersIn } from "@/lib/placeholders";
import { Button } from "@/registry/components/button/button";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { Textarea } from "@/registry/components/textarea/textarea";
import { ChannelIcon } from "./channel-icon";
import { ComposerLibrary } from "./composer-library";
import styles from "./accounts-composer.module.css";
import weekStyles from "./week-view.module.css";

/** Puts a template or a saved hashtag set into text: into empty text as it is, otherwise after what is written. */
export function insertInto(text: string, piece: string): string {
  return !text.trim() ? piece : `${text.replace(/\s+$/, "")}\n\n${piece}`;
}

type Load = { status: "loading" } | { status: "done"; accounts: ComposerAccount[] } | { status: "failed"; message: string };

/** The composer dialog; `preview` supplies accounts and saves nothing (the preview page only). */
export function AccountsComposer({ open, onClose, preview }: { open: boolean; onClose: (saved?: string) => void; preview?: ComposerAccount[] }) {
  const [load, setLoad] = useState<Load>(preview ? { status: "done", accounts: preview } : { status: "loading" });
  const [chosen, setChosen] = useState<string[]>([]);
  const [main, setMain] = useState("");
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<string>("main");
  const [problem, setProblem] = useState<string | null>(null);
  const [refused, setRefused] = useState<Record<string, string>>({});
  const [busy, start] = useTransition();
  const requestId = useRef<string>("");
  // The main text sent with this request id last time, so a retry never overwrites an edit made in Buffer meanwhile.
  const sentText = useRef<string | undefined>(undefined);
  const router = useRouter();

  // One request id per post written here, so a retry after an unclear answer finds the same post in Buffer.
  useEffect(() => {
    if (!open) return;
    requestId.current = crypto.randomUUID();
    sentText.current = undefined;
    if (preview) return;
    setLoad({ status: "loading" });
    readComposerAccounts()
      .then((r) => setLoad(r.ok ? { status: "done", accounts: r.accounts } : { status: "failed", message: r.message }))
      .catch(() => setLoad({ status: "failed", message: "Buffer did not return your accounts." }));
  }, [open, preview]);

  const accounts = load.status === "done" ? load.accounts : [];
  const picked = accounts.filter((a) => chosen.includes(a.id));
  const textFor = (id: string) => custom[id] ?? main;
  const usage = useMemo(() => Object.fromEntries(picked.map((a) => {
    const used = countFor(a.service, textFor(a.id));
    return [a.id, { used, over: a.limit !== null && used > a.limit }];
  })), [picked, main, custom]); // eslint-disable-line react-hooks/exhaustive-deps
  const overAny = picked.some((a) => usage[a.id]?.over);
  const unfilled = [...new Set(picked.flatMap((a) => placeholdersIn(textFor(a.id))).concat(placeholdersIn(main)))];
  const canSave = picked.length > 0 && main.trim() !== "" && !overAny && unfilled.length === 0 && !busy;

  const reset = () => { setChosen([]); setMain(""); setCustom({}); setTab("main"); setProblem(null); setRefused({}); };
  const close = (saved?: string) => { reset(); onClose(saved); };
  const toggle = (id: string) => {
    setProblem(null);
    setChosen((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));
    if (tab === id) setTab("main");
  };
  const insert = (piece: string) => {
    // Nothing changes the text while a save is running: the save sends what was on screen when it started.
    if (busy) return;
    const into = (t: string) => insertInto(t, piece);
    if (tab !== "main" && custom[tab] !== undefined) setCustom((c) => ({ ...c, [tab]: into(c[tab]) }));
    else setMain(into);
  };
  const save = () => {
    if (!canSave) return;
    setProblem(null);
    setRefused({});
    if (preview) return close(`Saved ${picked.length} drafts (preview: nothing was sent).`);
    start(async () => {
      const previousText = sentText.current;
      sentText.current = main;
      const r = await saveForAccounts({ requestId: requestId.current, text: main, previousText, versions: picked.map((a) => ({ channelId: a.id, text: textFor(a.id) })) })
        .catch(() => ({ ok: false as const, message: "Buffer did not answer clearly. Press Save again: the same post is found, never saved twice.", refused: undefined }));
      if (r.ok) { router.refresh(); return close(r.message); }
      setProblem(r.message);
      if (r.refused?.length) {
        setRefused(Object.fromEntries(r.refused.filter((x) => x.channelId).map((x) => [x.channelId, x.reason])));
        const first = r.refused.find((x) => x.channelId);
        if (first) setTab(first.channelId);
      }
    });
  };

  const counter = (a: ComposerAccount) => a.limit !== null && (
    <span className={`tnum ${usage[a.id]?.over ? weekStyles.over : ""}`} aria-live="polite">{(usage[a.id]?.used ?? 0).toLocaleString("en-GB")} / {a.limit.toLocaleString("en-GB")}</span>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) close(); }}>
      {open && (
        <DialogContent className={weekStyles.dialog} title="New post" description="Write it once, pick accounts, adjust each one. Saved as one Buffer draft per account; nothing is scheduled.">
          <div className={weekStyles.composer}>
            {load.status === "loading" && <p className={styles.muted} role="status">Loading your accounts…</p>}
            {load.status === "failed" && <p className={weekStyles.problem} role="alert">{load.message}</p>}
            {load.status === "done" && (
              <>
                <div className={styles.accounts} role="group" aria-label="Accounts">
                  {accounts.map((a) => {
                    const on = chosen.includes(a.id);
                    return (
                      <button key={a.id} type="button" className={styles.account} aria-pressed={on} disabled={a.disconnected || busy} title={a.disconnected ? "Reconnect this account in Buffer first" : undefined} onClick={() => toggle(a.id)}>
                        <ChannelIcon service={a.service} size={14} />
                        <span className={styles.accountName}>{a.name}</span>
                        {on && <Check size={13} strokeWidth={2.2} aria-hidden="true" />}
                      </button>
                    );
                  })}
                </div>

                {picked.length > 0 && (
                  <div className={styles.tabs} role="tablist" aria-label="Versions">
                    <button type="button" role="tab" aria-selected={tab === "main"} className={styles.tab} onClick={() => setTab("main")}>Main text</button>
                    {picked.map((a) => (
                      <button key={a.id} type="button" role="tab" aria-selected={tab === a.id} className={styles.tab} onClick={() => setTab(a.id)}>
                        <ChannelIcon service={a.service} size={13} />
                        {a.name}
                        {(usage[a.id]?.over || refused[a.id]) && <span className={styles.flag} aria-label="needs a change" />}
                      </button>
                    ))}
                  </div>
                )}

                {tab === "main" || !picked.some((a) => a.id === tab) ? (
                  <>
                    {picked[0] && <ComposerLibrary slotId={picked[0].id} onInsert={insert} disabled={busy} />}
                    <Textarea label="Main text" autoFocus value={main} rows={6} disabled={busy} onChange={(e) => { setMain(e.target.value); setProblem(null); }} />
                    <p className={styles.muted}>
                      {picked.length === 0 ? "Pick at least one account above." : `${picked.length - Object.keys(custom).filter((id) => chosen.includes(id)).length} of ${picked.length} account${picked.length === 1 ? "" : "s"} use this text.`}
                      {picked.filter((a) => usage[a.id]?.over && custom[a.id] === undefined).map((a) => ` Too long for ${a.name}.`).join("")}
                    </p>
                  </>
                ) : (
                  (() => {
                    const a = picked.find((x) => x.id === tab)!;
                    const own = custom[a.id];
                    return (
                      <div className={styles.version}>
                        {own === undefined ? (
                          <>
                            <p className={styles.muted}>{a.name} uses the main text.</p>
                            <blockquote className={styles.preview}>{main || <span className={styles.muted}>Nothing written yet.</span>}</blockquote>
                            <div className={weekStyles.composerFoot}><span>{a.limitFrom === "buffer" ? `${a.name}'s limit from Buffer` : `${a.service} limit`}</span>{counter(a)}</div>
                            <Button variant="secondary" size="sm" disabled={busy} onClick={() => setCustom((c) => ({ ...c, [a.id]: main }))}>Change it for {a.name}</Button>
                          </>
                        ) : (
                          <>
                            <ComposerLibrary slotId={a.id} onInsert={insert} disabled={busy} />
                            <Textarea label={`Text for ${a.name}`} autoFocus value={own} rows={6} disabled={busy} onChange={(e) => { setCustom((c) => ({ ...c, [a.id]: e.target.value })); setProblem(null); setRefused(({ [a.id]: _gone, ...rest }) => rest); }} />
                            <div className={weekStyles.composerFoot}><span>{a.limitFrom === "buffer" ? `${a.name}'s limit from Buffer` : `${a.service} limit`}</span>{counter(a)}</div>
                            <Button variant="ghost" size="sm" disabled={busy} onClick={() => setCustom(({ [a.id]: _gone, ...rest }) => rest)}>Use the main text again</Button>
                          </>
                        )}
                        {usage[a.id]?.over && <p className={weekStyles.problem} role="alert">Too long for {a.name} by {((usage[a.id]?.used ?? 0) - (a.limit ?? 0)).toLocaleString("en-GB")} characters.</p>}
                        {refused[a.id] && <p className={weekStyles.problem} role="alert">{refused[a.id]}</p>}
                      </div>
                    );
                  })()
                )}

                {unfilled.length > 0 && <p className={weekStyles.problem} role="status">Fill in {unfilled.map((n) => `{{${n}}}`).join(", ")} before saving.</p>}
                {problem && <p className={weekStyles.problem} role="alert">{problem}</p>}
                <div className={weekStyles.composerActions}>
                  <Button variant="primary" disabled={!canSave} onClick={save}>
                    {busy ? "Checking and saving…" : picked.length > 1 ? `Save ${picked.length} drafts` : "Save draft"}
                  </Button>
                  <Button variant="ghost" disabled={busy} onClick={() => close()}>Cancel</Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
