"use server";
import { revalidatePath } from "next/cache";
import { freshBufferForCurrentUser, signedInUserId } from "@/lib/current-user";
import { readPostsNow } from "@/lib/buffer/queries";
import { checkSources } from "@/lib/check-sources";
import { listSourcesToCheck, reportSourceVersion } from "@/lib/source-check";
import { latestSource } from "@/lib/source-store";
import { sourceCards } from "@/lib/source-presentation";
import { limit } from "@/lib/rate-limit";
import { editDraftText } from "./actions";

export async function checkMySources() {
  const userId = await signedInUserId();
  if (!userId) return { ok: false as const, message: "Sign in with Buffer first." };
  if (!(await limit("outbound", userId)).ok) return { ok: false as const, message: "Too many checks just now. Try again shortly." };
  try {
    const b = await freshBufferForCurrentUser();
    if (!b) return { ok: false as const, message: "Buffer could not be read." };
    const ids = [...new Set((await listSourcesToCheck(userId, b.posts)).flatMap(s => s.evidence.map(e => e.postId)))];
    const results = await checkSources(userId, () => readPostsNow(b.token, ids));
    revalidatePath("/"); revalidatePath("/week");
    return { ok: true as const, results };
  } catch { return { ok: false as const, message: "The sources could not be checked. No posts were changed." }; }
}

export async function recheckSourceEvidence(postId: string) {
  const b = await freshBufferForCurrentUser();
  if (!b || !b.posts.some(p => p.id === postId)) return { ok: false as const, message: "Read your Buffer drafts again." };
  if (!(await limit("outbound", b.userId)).ok) return { ok: false as const, message: "Too many checks just now. Try again shortly." };
  const sources = (await listSourcesToCheck(b.userId, b.posts)).filter(s => s.evidence.some(e => e.postId === postId));
  try {
    let unresolved = 0;
    for (const s of sources) {
      const latest = await latestSource(b.userId, s.sourceKey);
      if (!latest) continue;
      const result = await reportSourceVersion(b.userId, { sourceKey: s.sourceKey, uri: latest.uri, text: latest.text, title: latest.title ?? undefined, checkedBy: "user" }, () => readPostsNow(b.token, [...new Set(s.evidence.map(e => e.postId))]), latest.metadata);
      unresolved += result.pending;
    }
    revalidatePath("/"); revalidatePath("/week");
    if (!sources.length) return { ok: false as const, message: "This draft has no saved source evidence." };
    if (unresolved) return { ok: false as const, message: "Some evidence checks are unfinished. The draft still needs review; try again shortly." };
    const remaining = (await sourceCards(b.userId, await readPostsNow(b.token, [postId]))).some(c => c.needsCheck);
    return { ok: !remaining, message: remaining ? "The check found unsupported text. Review the proposed correction before approving." : "Checked against the latest saved source. Check sources to fetch newer text." };
  } catch { return { ok: false as const, message: "The evidence check could not finish. Try again." }; }
}

/** Read the proposal again on the server. A client cannot substitute a rewrite or approve a scheduled post. */
export async function applySourceFix(postId: string, snapshotId: string) {
  const b = await freshBufferForCurrentUser();
  if (!b) return { ok: false as const, message: "Sign in with Buffer first." };
  const card = (await sourceCards(b.userId, b.posts)).find(c => c.postId === postId && c.snapshotId === snapshotId && c.rewrite && c.editable);
  if (!card?.rewrite) return { ok: false as const, message: "This proposal is no longer current. Check the source again." };
  const r = await editDraftText(card.postId, card.rewrite, card.draftText);
  if (!r.ok) return r;
  const check = await recheckSourceEvidence(postId);
  return { ok: true as const, message: check.ok ? "Draft updated. Its evidence was checked again; approval is separate." : "Draft updated. Its evidence still needs a check before approval." };
}
