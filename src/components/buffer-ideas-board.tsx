"use client";

/**
 * The person's Buffer ideas board, read only, laid out like Buffer's own board: columns side by side with a count,
 * ideas as cards with a title and the start of the text. Wide boards scroll sideways inside the section, never the
 * page. Changes happen in Buffer, or through the person's AI when they ask it to save an idea.
 */
import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import { readIdeaBoards, type IdeaBoard } from "@/app/(app)/idea-actions";
import { Skeleton } from "@/registry/components/skeleton/skeleton";
import styles from "./buffer-ideas-board.module.css";

const BUFFER_IDEAS_URL = "https://publish.buffer.com/create/ideas";
type State = { status: "loading" } | { status: "done"; boards: IdeaBoard[] } | { status: "failed"; message: string };

/** Loads the boards after the page shows; `preview` shows given boards (preview page only). */
export function BufferIdeasBoard({ preview }: { preview?: IdeaBoard[] }) {
  const [state, setState] = useState<State>(preview ? { status: "done", boards: preview } : { status: "loading" });

  useEffect(() => {
    if (preview) return;
    let live = true;
    readIdeaBoards()
      .then((r) => { if (live) setState(r.ok ? { status: "done", boards: r.boards } : { status: "failed", message: r.message }); })
      .catch(() => { if (live) setState({ status: "failed", message: "Buffer did not return your ideas. Try again in a minute." }); });
    return () => { live = false; };
  }, [preview]);

  return (
    <section className={styles.section} aria-labelledby="buffer-ideas">
      <div className={styles.head}>
        <div>
          <h2 id="buffer-ideas" className={styles.h2}>Your Buffer ideas</h2>
          <p className={styles.sub}>Your AI reads these and can save a new idea here when you ask.</p>
        </div>
        <a className={styles.open} href={BUFFER_IDEAS_URL} target="_blank" rel="noreferrer">Open in Buffer <ArrowUpRight size={14} strokeWidth={2} aria-hidden="true" /></a>
      </div>
      {state.status === "loading" && <Skeleton label="Loading your Buffer ideas" lines={3} />}
      {state.status === "failed" && <p className={styles.muted} role="status">{state.message}</p>}
      {state.status === "done" && state.boards.length === 0 && <p className={styles.muted}>No Buffer channels yet, so there is no ideas board to show.</p>}
      {state.status === "done" && state.boards.map((board, i) => (
        <div key={board.organizationId} className={styles.board}>
          {state.boards.length > 1 && <h3 className={styles.org}>Organization {i + 1}</h3>}
          <div className={styles.columns} role="list" aria-label="Ideas board">
            {board.columns.map((col) => (
              <section key={col.id} className={styles.column} role="listitem" aria-label={`${col.name}, ${col.ideas.length} ${col.ideas.length === 1 ? "idea" : "ideas"}`}>
                <h4 className={styles.colHead}>{col.name}<span className={styles.count}>{col.ideas.length}</span></h4>
                {col.ideas.length === 0
                  ? <p className={styles.empty}>No ideas</p>
                  : <ul className={styles.cards}>
                      {col.ideas.map((idea) => (
                        <li key={idea.id} className={styles.card}>
                          {idea.title && <p className={styles.title}>{idea.title}</p>}
                          {idea.text && <p className={styles.text}>{idea.text}</p>}
                          {!idea.title && !idea.text && <p className={styles.text}>An idea with media only.</p>}
                        </li>
                      ))}
                    </ul>}
              </section>
            ))}
          </div>
          {board.more && <p className={styles.muted}>Showing the newest 100. The rest are in Buffer.</p>}
        </div>
      ))}
    </section>
  );
}
