"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/registry/components/button/button";
import { Select } from "@/registry/components/select/select";
import { Textarea } from "@/registry/components/textarea/textarea";
import { NETWORKS, parseNewRule, type NewRule } from "@/lib/rules";
import styles from "./playbook-view.module.css";

/** Wait this long after the last keystroke before reading the rule, so a reading costs one model call per pause. */
const READ_AFTER_MS = 700;

/** The parts of a reading the person sees as tags under the box. */
function tagsFor(r: NewRule): string[] {
  switch (r.kind) {
    case "banned": return [r.where === "start" ? "Never opens with" : r.where === "end" ? "Never ends with" : "Never uses", `"${r.phrases[0]}"`];
    case "replace": return [`Says "${r.to}"`, `never "${r.from}"`];
    case "ends_with": return ["Every post ends with", `"${r.phrase}"`];
    case "guidance": return ["Judged by meaning"];
  }
}

/**
 * Adds a rule as one sentence in the person's own words. While they type, it shows how Queue Pilot reads the sentence
 * (a banned phrase, a replacement, a required ending, or judged by meaning), and they can drop the reading to keep the
 * rule as written. The reading they saw is the one saved. A new rule flags drafts by default; "Do not save it" is a choice.
 */
export function RuleForm({ onAdd, read }: { onAdd: (rule: NewRule, raw: Record<string, unknown>) => Promise<string | null>; read?: (text: string) => Promise<NewRule | null> }) {
  const [text, setText] = useState("");
  const [network, setNetwork] = useState("all");
  const [level, setLevel] = useState("warn");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Set at once, unlike state: a held or doubled ⌘ Enter must not add the same rule twice before the re-render.
  const adding = useRef(false);
  const [reading, setReading] = useState<{ for: string; rule: NewRule | null } | null>(null);
  const [pending, setPending] = useState(false);
  const asked = useRef(0);

  useEffect(() => {
    if (!read || text.trim().length < 4) { setReading(null); setPending(false); return; }
    // Back to text already read: cancel any request still out, so its late answer cannot replace this one.
    if (reading?.for === text) { asked.current++; setPending(false); return; }
    const ask = ++asked.current;
    setPending(true);
    const t = setTimeout(async () => {
      const r = await read(text).catch(() => null);
      if (ask !== asked.current) return;
      setPending(false);
      setReading({ for: text, rule: r });
    }, READ_AFTER_MS);
    return () => clearTimeout(t);
  }, [text, read, reading?.for]);

  const current = reading?.for === text ? reading.rule : null;
  // Read means a reading came back for exactly this text; until then the box says it is reading, never a guess.
  const read_ = reading?.for === text;

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (adding.current) return;
    const raw: Record<string, unknown> = { kind: "guidance", text, channels: network === "all" ? "all" : [network], level, ...(current ? { reading: current } : {}) };
    const rule = parseNewRule(raw);
    if (typeof rule === "string") return setProblem(rule);
    adding.current = true;
    setBusy(true);
    const err = await onAdd(rule, raw).finally(() => { adding.current = false; setBusy(false); });
    setProblem(err);
    if (!err) { setText(""); setReading(null); }
  };

  return (
    <form className={styles.form} onSubmit={submit} aria-labelledby="add-title">
      <h2 id="add-title" className={styles.h2}>Add a rule</h2>
      <Textarea
        id="rule-text"
        label="The rule, as you would say it"
        value={text}
        rows={2}
        placeholder={'Say "stock", never "broth". Name the dish in the first line.'}
        maxLength={200}
        onChange={(e) => { setText(e.target.value); setProblem(null); }}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void submit(); } }}
      />
      {text.length > 150 && <p className={styles.count} aria-live="polite"><span className="tnum">{text.length}</span> of 200 characters</p>}
      {read && text.trim().length >= 4 && !(read_ && !pending && !current) && (
        <div className={styles.reading} aria-live="polite">
          <span className={styles.readingLabel}>Reads as</span>
          {current ? (
            <>
              {tagsFor(current).map((t) => <span key={t} className={styles.tag} data-kind={current.kind}>{t}</span>)}
              {current.kind !== "guidance" && (
                <button type="button" className={styles.untag} onClick={() => setReading({ for: text, rule: { kind: "guidance", text, channels: "all", level: "warn" } })}>Keep as written</button>
              )}
            </>
          ) : <span className={styles.readingWait}>Reading…</span>}
        </div>
      )}
      <div className={styles.formFields}>
        <Select label="Applies to" value={network} onValueChange={setNetwork} options={[{ value: "all", label: "Every network" }, ...Object.entries(NETWORKS).map(([value, label]) => ({ value, label }))]} />
        <Select label="If a draft breaks it" value={level} onValueChange={setLevel} options={[{ value: "warn", label: "Save it and flag it" }, { value: "block", label: "Do not save it" }]} />
      </div>
      {problem && <p className={styles.problem} role="alert">{problem}</p>}
      <div><Button type="submit" variant="primary" disabled={busy || !text.trim()}>{busy ? "Adding…" : "Add rule"}</Button></div>
    </form>
  );
}
