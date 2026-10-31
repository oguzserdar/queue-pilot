import { STATE_WORD, type PostState } from "@/lib/post-state";
import styles from "./state-mark.module.css";

/** A post's state as a small mark (in lists) or a mark with its word (in detail). Screen readers always hear the word. */
export function StateMark({ state, word = false }: { state: PostState; word?: boolean }) {
  return (
    <span className={styles.mark} data-state={state} title={word ? undefined : STATE_WORD[state]}>
      <span className={styles.dot} aria-hidden="true" />
      {word ? <span className={styles.word}>{STATE_WORD[state]}</span> : <span className="sr-only">{STATE_WORD[state]}</span>}
    </span>
  );
}
