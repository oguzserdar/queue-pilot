"use client";

import { SignInButton } from "./sign-in-button";

import { useState, useTransition } from "react";
import { Button } from "@/registry/components/button/button";
import { EmptyState } from "@/registry/components/empty-state/empty-state";
import { Textarea } from "@/registry/components/textarea/textarea";
import { addPastedVoiceExample, addVoiceExample, removeVoiceExample, saveVoiceNote } from "@/app/(app)/actions"
import { MAX_EXAMPLES, MAX_NOTE, MAX_PASTED_TEXT } from "@/lib/voice-limits"
import styles from "./voice-view.module.css";

const EXAMPLES = [
  { id: "e1", channel: "LinkedIn", text: "Soup weather. Here is the one I make on repeat: white beans, kale, and the bread you were about to throw out." },
  { id: "e2", channel: "Instagram", text: "Three pantry swaps that save a weeknight. Recipe in the newsletter, link in bio." },
  { id: "e3", channel: "X", text: "Stock from scraps: onion skins, carrot ends, parmesan rind. Issue 37 has the rest." },
];

/** Live mode: the person's picked example posts, their note, and recent sent posts to pick from. */
export type VoiceLive = {
  candidates: { postId: string; channel: string; text: string }[];
  examples: { postId: string; channel: string; text: string }[];
  note: string | null;
};

/**
 * Voice: the user's example posts and their note on how they write. Example mode shows a sample account; live mode
 * lets the person pick from their own sent posts. Their AI reads both through the connector before drafting.
 */
export function VoiceView(props: ({ mode: "example" } | ({ mode: "live" } & VoiceLive))) {
  if (props.mode === "live") return <LiveVoice {...props} />;
  return <ExampleVoice />;
}

function LiveVoice({ candidates, examples, note }: VoiceLive) {
  const [pending, start] = useTransition();
  const [draft, setDraft] = useState(note ?? "");
  const [pasted, setPasted] = useState("")
  const [pasteMessage, setPasteMessage] = useState<{ ok: boolean, text: string } | null>(null)
  const [message, setMessage] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const picked = new Set(examples.map((e) => e.postId));
  const run = (fn: () => Promise<{ ok: boolean; message?: string }>, done?: string) =>
    start(async () => {
      const r = await fn();
      setMessage(r.ok ? (done ? { tone: "ok", text: done } : null) : { tone: "bad", text: r.message ?? "Something went wrong." });
    });

  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Your voice</h1>
        <p className={styles.sub}>Pick a few of your own posts and say how you write. Your AI reads these before it drafts, and matches them.</p>
      </header>

      <section aria-labelledby="note" className={styles.block}>
        <div className={styles.blockHead}>
          <h2 id="note" className={styles.h2}>How you write</h2>
        </div>
        <form
          className={styles.noteForm}
          onSubmit={(e) => {
            e.preventDefault();
            run(() => saveVoiceNote(draft), "Saved.");
          }}
        >
          <Textarea label="Your note" description="For example: short, plain, no emojis, one link at the end." value={draft} maxLength={MAX_NOTE} onChange={(e) => setDraft(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={pending}>Save note</Button>
        </form>
      </section>

      <section aria-labelledby="examples" className={styles.block}>
        <div className={styles.blockHead}>
          <h2 id="examples" className={styles.h2}>Example posts ({examples.length} of 8)</h2>
        </div>
        {examples.length === 0 ? (
          <p className={styles.muted}>Paste something you wrote or choose a recent post below.</p>
        ) : (
          <ul className={styles.examples}>
            {examples.map((e) => (
              <li key={e.postId} className={styles.example}>
                <span className={styles.channel}>{e.channel}</span>
                <p>{e.text}</p>
                <Button variant="secondary" size="sm" disabled={pending} onClick={() => run(() => removeVoiceExample(e.postId))}>Remove</Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="recent" className={styles.block}>
        <form className={styles.noteForm} onSubmit={(e) => {
          e.preventDefault()
          start(async () => {
            const result = await addPastedVoiceExample(pasted)
            setPasteMessage({ ok: result.ok, text: result.ok ? "Example added." : result.message })
            if (result.ok) setPasted("")
          })
        }}>
          <Textarea label="Paste a post you wrote" description={`Up to ${MAX_PASTED_TEXT} characters.`} value={pasted} maxLength={MAX_PASTED_TEXT} disabled={pending} onChange={(e) => setPasted(e.target.value)} />
          <Button type="submit" variant="secondary" disabled={pending || !pasted.trim() || examples.length >= MAX_EXAMPLES}>Add example</Button>
          {pasteMessage && <p className={pasteMessage.ok ? styles.muted : styles.bad} role="status">{pasteMessage.text}</p>}
        </form>
        <div className={styles.blockHead}>
          <h2 id="recent" className={styles.h2}>Add from Buffer</h2>
        </div>
        {candidates.length === 0 ? (
          <EmptyState title="No sent posts yet" description="Your posts appear here after Buffer publishes something. Pick a few that sound like you, and your AI writes like them." />
        ) : candidates.every((c) => picked.has(c.postId)) ? (
          <p className={styles.muted}>You picked every recent post. New ones show up here after Buffer publishes them.</p>
        ) : (
          <ul className={styles.examples}>
            {candidates.filter((c) => !picked.has(c.postId)).map((c) => (
              <li key={c.postId} className={styles.example}>
                <span className={styles.channel}>{c.channel}</span>
                <p>{c.text}</p>
                <Button variant="secondary" size="sm" disabled={pending || examples.length >= 8} onClick={() => run(() => addVoiceExample(c.postId))}>Use as example</Button>
              </li>
            ))}
          </ul>
        )}
        {examples.length >= 8 && <p className={styles.muted}>8 examples is the most. Remove one to pick another.</p>}
      </section>
      {message && <p className={message.tone === "ok" ? styles.muted : styles.bad} role="status">{message.text}</p>}
    </div>
  );
}

function ExampleVoice() {
  return (
    <div className={styles.page}>
      <header className={styles.head}>
        <h1 className={styles.title}>Mark's voice</h1>
        <p className={styles.sub}>A note on how he writes and a few of his own posts. Drafts match them. Rules from his fixes live in the <a href="/playbook">playbook</a>.</p>
      </header>

      <section aria-labelledby="note" className={styles.block}>
        <h2 id="note" className={styles.h2}>How he writes</h2>
        <p>Warm and short. The dish first, then one useful detail. Says "stock", never "broth". One link at the end.</p>
      </section>

      <section aria-labelledby="examples" className={styles.block}>
        <div className={styles.blockHead}>
          <h2 id="examples" className={styles.h2}>Example posts ({EXAMPLES.length} of 8)</h2>
          <SignInButton>Add from Buffer</SignInButton>
        </div>
        <ul className={styles.examples}>
          {EXAMPLES.map((e) => (
            <li key={e.id} className={styles.example}>
              <span className={styles.channel}>{e.channel}</span>
              <p>{e.text}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
