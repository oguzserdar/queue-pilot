/**
 * The words on a button that starts a read or a check: its busy words while it runs, its again words once it has an
 * answer, and its first words before that.
 *
 * @param busy - The action is running
 * @param done - An answer from an earlier run is on screen
 * @param words - What the button says in each of the three states
 * @returns The label for the current state
 */
export function actionLabel(busy: boolean, done: boolean, words: { busy: string; again: string; first: string }): string {
  if (busy) return words.busy;
  return done ? words.again : words.first;
}
