"use client";

import { Alert } from "@/registry/components/alert/alert";
import { Badge } from "@/registry/components/badge/badge";
import { AiUsage } from "./ai-usage";

import { useState, useTransition } from "react";
import { removeAiKey, saveAiKey, setAiModel } from "@/app/(app)/actions";
import { Select } from "@/registry/components/select/select";
import { ConfirmButton } from "./confirm-button";
import { Button } from "@/registry/components/button/button";
import { useToastStack } from "@/registry/components/toast-stack/toast-stack";
import { PasswordField } from "@/registry/components/password-field/password-field";
import styles from "./settings-view.module.css";

/** models is the provider's current list for this key; null when it could not be read just now. */
export type ShownAiKey = { provider: string; masked: string; model: string | null; models: { id: string; name: string }[] | null } | null;

/**
 * The person's own AI key, for "Write drafts with my AI" on Next week. Shows only the masked key; the full key is
 * sent once, to the server, and stored encrypted.
 */
export function AiKeyCard({ shown, allowance, notice }: { shown: ShownAiKey | undefined; allowance: { used: number; cap: number; budgetUsd: number; leftUsd: number; resetsAt: string } | null; notice: { ok: boolean; text: string } | null }) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(notice);
  const { toast } = useToastStack();
  // A success becomes a short message in the corner; a problem stays next to the button that caused it.
  const say = (m: NonNullable<typeof message>) => { if (m.ok) { toast({ type: "success", title: m.text }); setMessage(null); } else setMessage(m); };
  const [pending, start] = useTransition();
  // With built-in AI on, the key box waits behind "Use my own key" so the usage reads first.
  const [ownKey, setOwnKey] = useState(false);

  if (shown === undefined) return <p className={styles.muted}>Queue Pilot could not read your key just now. Reload the page.</p>;
  return (
    <>
      {shown ? (
        <>
        <div className={styles.rows}>
          <div className={styles.row}>
            <div className={styles.name}>
              <strong>{shown.provider}</strong>
              <span className={styles.muted}>{shown.masked}</span>
            </div>
            <ConfirmButton variant="secondary" label="Remove" question="Remove your AI key? Drafting with it stops until you add one again." confirmLabel="Remove key" pending={pending} onConfirm={() => start(async () => {
              const r = await removeAiKey();
              say(r.ok ? { ok: true, text: "Key removed." } : { ok: false, text: r.message });
            })} />
          </div>
          <div className={styles.row}>
            {shown.models ? (
              <Select label="Model" value={shown.model ?? ""} options={shown.models.map((m) => ({ value: m.id, label: m.name }))} onValueChange={(model) => start(async () => {
                const r = await setAiModel(model);
                say(r.ok ? { ok: true, text: "Model changed." } : { ok: false, text: r.message });
              })} />
            ) : (
              <span className={styles.muted}>Model {shown.model ?? "not set"}. The provider's list could not be read just now.</span>
            )}
          </div>
        </div>
        <p className={styles.muted}>The list comes from your provider for this key. The default is chosen from it: {shown.provider.startsWith("Anthropic") ? "the newest active Sonnet model" : shown.provider.startsWith("OpenRouter") ? "Claude Sonnet when your key can use it, from the models that return structured output" : "the newest small model by name, since OpenAI's list does not say what each model is for"}.</p>
        </>
      ) : (
        <>
        {/* What powers drafting right now comes first; the key box is the way to change it. */}
        {allowance ? (
          <div className={styles.usageCard}>
            <div>
              <div className={styles.usageLabel}>Drafting with</div>
              <div className={styles.usageSource}>Built-in AI <Badge size="sm" tone="success">On</Badge></div>
            </div>
            <AiUsage view="person" {...allowance} />
            <div className={styles.usageFoot}>
              <span>Your own key has no daily limit, and your provider bills you.</span>
              {!ownKey && <Button variant="secondary" size="sm" onClick={() => setOwnKey(true)}>Use my own key</Button>}
            </div>
          </div>
        ) : (
          <Alert tone="info" title="No AI here yet">
            Connect your AI app on the Connect page, or add your own key below.
          </Alert>
        )}
        {(!allowance || ownKey) && (
        <form
          className={styles.deleteForm}
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const r = await saveAiKey(value);
              if (r.ok) setValue("");
              say(r.ok ? { ok: true, text: "Saved. Use Write drafts with my AI on Next week." } : { ok: false, text: r.message });
            });
          }}
        >
          <PasswordField id="ai-key-input" label="Anthropic (sk-ant-…), OpenAI (sk-…) or OpenRouter (sk-or-…) key" autoComplete="off" spellCheck={false} value={value} onChange={(e) => setValue(e.target.value)} placeholder="sk-…" />
          <div className={styles.deleteActions}>
            <Button type="submit" variant="primary" size="sm" disabled={pending || !value.trim()}>{pending ? "Saving…" : "Save key"}</Button>
            <a className={styles.muted} href="/api/openrouter/start">Or connect your OpenRouter account</a>
          </div>
        </form>
        )}
        </>
      )}
      {message && <p className={message.ok ? styles.muted : styles.problem} role={message.ok ? "status" : "alert"}>{message.text}</p>}
    </>
  );
}
