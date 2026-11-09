/**
 * On Vercel, the alarm clock for one scheduled direct post: it sleeps until the post's time, then asks the due run to
 * send that post at that revision. It decides nothing itself. An edit, a time change or a cancel bumps the revision,
 * so this timer then sends nothing and the new one does; if the timer is lost, the Docker check or the daily job sends
 * the post instead. A place that follows a Buffer post can be put off while Buffer has not published it; the timer
 * then sleeps until the next check the run asks for, at most 60 times (a day of checks: every 5 minutes for 2 hours, then hourly).
 */
import { sleep } from "workflow";

const MAX_WAKES = 60;

/**
 * Sleeps until sendAt, then sends the post if it is still due at this revision, and again at each later check.
 *
 * @param postId - The post's id
 * @param revision - The revision this timer was set for
 * @param sendAt - ISO time the post goes out (for a follow-up, its Buffer post's time plus a minute)
 */
export async function directPostTimer(postId: string, revision: number, sendAt: string) {
  "use workflow";
  let at = sendAt;
  for (let wake = 0; wake < MAX_WAKES; wake++) {
    await sleep(new Date(at));
    const r = await sendIfDue(postId, revision);
    if (!r.next) return r;
    at = r.next;
  }
  return { handled: 0, sent: 0, next: null };
}

async function sendIfDue(postId: string, revision: number) {
  "use step";
  const { runDueDirectPosts } = await import("@/lib/direct-post-run");
  return runDueDirectPosts({ postId, revision });
}
