/**
 * On Vercel, the alarm clock for one scheduled direct post: it sleeps until the post's time, then asks the due run to
 * send that post at that revision. It decides nothing itself. An edit, a time change or a cancel bumps the revision,
 * so this timer then sends nothing and the new one does; if the timer is lost, the Docker check or the daily job sends
 * the post instead.
 */
import { sleep } from "workflow";

/**
 * Sleeps until sendAt, then sends the post if it is still due at this revision.
 *
 * @param postId - The post's id
 * @param revision - The revision this timer was set for
 * @param sendAt - ISO time the post goes out
 */
export async function directPostTimer(postId: string, revision: number, sendAt: string) {
  "use workflow";
  await sleep(new Date(sendAt));
  return await sendIfDue(postId, revision);
}

async function sendIfDue(postId: string, revision: number) {
  "use step";
  const { runDueDirectPosts } = await import("@/lib/direct-post-run");
  return runDueDirectPosts({ postId, revision });
}
