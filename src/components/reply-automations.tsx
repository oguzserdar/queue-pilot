"use client";

/**
 * Reply automations on the Channels tab: each one reads as a sentence ("When someone comments GUIDE on any post of
 * @ada, reply with…"), and the editor is the same sentence as a form, with a live preview of the comment and the
 * reply beside it. Every reply still passes the person's rules and judge, so the preview says so instead of promising
 * the text goes out unchecked.
 */
import { useMemo, useState, useTransition } from "react";
import { Button } from "@/registry/components/button/button";
import { Card } from "@/registry/components/card/card";
import { Input } from "@/registry/components/input/input";
import SegmentedControl from "@/registry/components/segmented-control/segmented-control";
import { Select } from "@/registry/components/select/select";
import { Switch } from "@/registry/components/switch/switch";
import { TagInput } from "@/registry/components/tag-input/tag-input";
import { Textarea } from "@/registry/components/textarea/textarea";
import { deleteAutomationAction, saveAutomationAction } from "@/app/(app)/automation-actions";
import { keywordMatches } from "@/lib/reply-automations";
import { ConfirmButton } from "./confirm-button";
import styles from "./settings-view.module.css";
import own from "./reply-automations.module.css";
import channelStyles from "./sources-view.module.css";
import type { SocialNetwork } from "@/lib/social-networks";

/** One automation as the page sends it to the browser. */
export type AutomationRow = {
  id: string; accountId: string; name: string; active: boolean; post: { scope: "any" } | { scope: "post"; externalId: string };
  keywords: string[]; replyMode: "voice" | "fixed"; replyTexts: string[]; link: string | null;
};
type Account = { id: string; handle: string; network: SocialNetwork };

const blank = (accountId: string): AutomationRow => ({ id: "", accountId, name: "", active: true, post: { scope: "any" }, keywords: [], replyMode: "fixed", replyTexts: [""], link: null });

/** The automation as one plain sentence, as the list shows it. */
export function automationSentence(a: AutomationRow, handle: string): string {
  const words = a.keywords.length ? `comments ${a.keywords.map((k) => `“${k}”`).join(" or ")}` : "comments anything";
  const where = a.post.scope === "post" ? "on one post" : "on any post";
  const reply = a.replyMode === "fixed" ? `reply with your text${a.replyTexts.length > 1 ? ` (${a.replyTexts.length} versions)` : ""}` : "reply in your voice";
  return `When someone ${words} ${where} of ${handle}, ${reply}${a.link ? " and the link" : ""}.`;
}

/**
 * @param accounts - The person's connected Mastodon and Bluesky accounts
 * @param automations - Their automations
 * @param example - The signed-out example: saving answers "Sign in with Buffer first"
 */
export function ReplyAutomations({ accounts, automations, example = false }: { accounts: Account[]; automations: AutomationRow[]; example?: boolean }) {
  const [editing, setEditing] = useState<AutomationRow | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const handleOf = (id: string) => accounts.find((a) => a.id === id)?.handle ?? "this account";
  const act = (run: () => Promise<{ ok: boolean; message: string }>, after?: () => void) => start(async () => {
    if (example) { setNote({ ok: false, text: "Sign in with Buffer first." }); return; }
    const r = await run().catch(() => ({ ok: false, message: "Queue Pilot did not answer. Try again." }));
    setNote({ ok: r.ok, text: r.message });
    if (r.ok) after?.();
  });

  return (
    <section className={styles.block} aria-labelledby="automations">
      <h2 id="automations" className={styles.h2}>Reply automations</h2>
      <p className={channelStyles.foot}>Answer comments that ask for something, like a guide or a link. Without an automation, an account with replies on answers every mention in your voice. With one, it answers only the comments an automation matches; the rest wait in the inbox. Every reply still passes your rules and the judge.</p>
      {note && <p className={note.ok ? styles.saved : styles.problem} role="status">{note.text}</p>}
      {automations.map((a) => (
        <Card key={a.id} title={a.name} description={automationSentence(a, handleOf(a.accountId))}>
          <div className={styles.confirm}>
            <Switch label="On" checked={a.active} disabled={pending} onCheckedChange={(on) => act(() => saveAutomationAction({ ...a, active: on }))} />
            <Button variant="secondary" size="sm" onClick={() => setEditing(a)}>Edit</Button>
            <ConfirmButton variant="secondary" label="Delete" question={`Delete “${a.name}”? Replies it already sent stay in the inbox.`} confirmLabel="Delete automation" pending={pending} onConfirm={() => act(() => deleteAutomationAction(a.id))} />
          </div>
        </Card>
      ))}
      {accounts.length === 0 && <p className={styles.muted}>Connect a Mastodon or Bluesky account above to add one.</p>}
      {accounts.length > 0 && editing && (
        <Editor value={editing} accounts={accounts} pending={pending} onCancel={() => setEditing(null)}
          onSave={(row) => act(() => saveAutomationAction({ ...row, id: row.id || undefined, replyTexts: row.replyMode === "fixed" ? row.replyTexts.map((t) => t.trim()).filter(Boolean) : [], link: row.link?.trim() || null }), () => setEditing(null))} />
      )}
      {accounts.length > 0 && !editing && (
        <div className={styles.deleteActions}><Button variant="secondary" size="sm" onClick={() => setEditing(blank(accounts[0].id))}>Add an automation</Button></div>
      )}
    </section>
  );
}

function Editor({ value, accounts, pending, onSave, onCancel }: { value: AutomationRow; accounts: Account[]; pending: boolean; onSave: (row: AutomationRow) => void; onCancel: () => void }) {
  const [row, setRow] = useState(value);
  const [sample, setSample] = useState(value.keywords[0] ? `Can I get the ${value.keywords[0]}?` : "Can I get the guide?");
  const set = (patch: Partial<AutomationRow>) => setRow((r) => ({ ...r, ...patch }));
  const handle = accounts.find((a) => a.id === row.accountId)?.handle ?? "";
  const matches = keywordMatches(sample, row.keywords);
  const reply = useMemo(() => {
    const base = row.replyMode === "fixed" ? row.replyTexts.find((t) => t.trim()) ?? "" : "Written in your voice when a real comment arrives.";
    return row.link && row.replyMode === "fixed" && !base.includes(row.link) ? `${base} ${row.link}` : base;
  }, [row]);

  return (
    <form className={own.editor} onSubmit={(e) => { e.preventDefault(); onSave(row); }}>
      <div className={own.form}>
        <Input label="Name" placeholder="Guide" value={row.name} onChange={(e) => set({ name: e.target.value })} required maxLength={80} />
        <Select label="On this account" value={row.accountId} options={accounts.map((a) => ({ value: a.id, label: a.handle }))} onValueChange={(v) => set({ accountId: v })} />
        <span className={own.caption} aria-hidden="true">When someone comments on</span>
        <SegmentedControl label="When someone comments on" value={row.post.scope} onValueChange={(v: string) => set({ post: v === "post" ? { scope: "post", externalId: "" } : { scope: "any" } })}
          options={[{ value: "any", label: "Any post" }, { value: "post", label: "One post" }]} />
        {row.post.scope === "post" && <Input label="The post's link or id" value={row.post.externalId} onChange={(e) => set({ post: { scope: "post", externalId: e.target.value } })} required />}
        <TagInput label="And the comment has" description="Whole words, any letter case. Leave empty for any comment." placeholder="guide" value={row.keywords} onValueChange={(v) => set({ keywords: v })} />
        <span className={own.caption} aria-hidden="true">Reply with</span>
        <SegmentedControl label="Reply with" value={row.replyMode} onValueChange={(v: string) => set({ replyMode: v === "voice" ? "voice" : "fixed" })}
          options={[{ value: "fixed", label: "My text" }, { value: "voice", label: "My voice (AI)" }]} />
        {row.replyMode === "fixed" && (
          <Textarea label="Reply versions" description="One per line, up to 10. Queue Pilot picks one per comment, so replies do not all read the same." rows={3}
            value={row.replyTexts.join("\n")} onChange={(e) => set({ replyTexts: e.target.value.split("\n").slice(0, 10) })} />
        )}
        <Input label="Link (optional)" placeholder="https://" value={row.link ?? ""} onChange={(e) => set({ link: e.target.value || null })} />
        <Switch label="On" checked={row.active} onCheckedChange={(on) => set({ active: on })} />
        <div className={styles.deleteActions}>
          <Button type="button" variant="secondary" size="sm" onClick={onCancel}>Cancel</Button>
          <Button type="submit" size="sm" loading={pending}>Save automation</Button>
        </div>
      </div>
      <aside className={own.preview} aria-label="Preview">
        <Input label="Try a comment" value={sample} onChange={(e) => setSample(e.target.value)} />
        <div className={own.phone}>
          <p className={own.comment}><strong>@someone</strong> {sample}</p>
          {matches ? (
            <p className={own.reply}><strong>{handle}</strong> {reply || "Write a reply version."}</p>
          ) : (
            <p className={own.miss}>No match: kept in the inbox, not answered.</p>
          )}
        </div>
        <p className={styles.muted}>Before it is sent, every reply is checked against your rules and the judge. One that fails waits in the inbox with the reason.</p>
      </aside>
    </form>
  );
}
