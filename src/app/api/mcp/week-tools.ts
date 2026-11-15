/**
 * @fileoverview Connector tools for the week: what is planned and delivered, the open slots, and saving, changing, deleting, moving back and approving drafts.
 * @module app/api/mcp/week-tools
 */
import { evidenceInput } from "@/lib/source-evidence";
import { postsBetween } from "@/lib/posts-between";
import { deliveriesFromBuffer } from "@/lib/delivery-model";
import { weekFromBuffer, weekRange } from "@/lib/week-from-buffer";
import { openSlots } from "@/lib/open-slots";
import { checkNote, judgeEdit, PLAYBOOK_REFUSAL, saveDraftsForUser } from "@/lib/save-for-user";
import { limitFor } from "@/lib/char-limits";
import { approverFor } from "@/lib/rule-origin";
import { draftSlot, recordAction } from "@/lib/security-events";
import { limit } from "@/lib/rate-limit";
import { deleteDraft, updateDraft, moveToDraft } from "@/lib/edit-drafts";
import { repairDraftEvidence } from "@/lib/repair-draft-evidence";
import { postgresWrittenStore, wroteIds } from "@/lib/written-store";
import { MAX_APPROVE } from "@/lib/approve-drafts";
import { approveChecked, recordApprover } from "@/lib/approve-checked";
import { approvePermission, claimApproval, releaseApproval, signApproval, verifyApproval } from "@/lib/agent-permission";
import { readPostsNow } from "@/lib/buffer/queries";
import * as z from "zod";
import { registerGuardedTool } from "@/lib/mcp-guard";
import { McpContext, asOf, bufferFor, patchSnapshot, slotRows, text, typed } from "./tool-kit";

/** Reads of the week, the delivered week and the open slots. */
export function registerWeekReads(c: McpContext): void {
  const { server, auth, userId } = c;
  registerGuardedTool(server, 
    "show_next_week",
    {
      title: "Show next week",
      description: "Use this when the user asks what is planned. It shows one Monday-to-Sunday week of their Buffer queue, next week unless week is \"this\": for each posting slot, the channel and either the post in it (status, post id, text) or EMPTY. Pass a post id to update_draft, delete_draft or approve_drafts. To fill empty slots, use list_open_slots instead: it covers 14 days and gives slot ids.",
      inputSchema: z.object({ week: z.enum(["next", "this"]).optional().describe("next (default) is the following Monday to Sunday; this is the week today is in.") }),
      outputSchema: z.object({ label: z.string(), asOf: z.string(), paused: z.array(z.string()).describe("Channels whose queue is paused in Buffer"), slots: z.array(z.object({ day: z.string(), time: z.string(), channelId: z.string(), channel: z.string(), disconnected: z.boolean(), post: z.object({ id: z.string(), status: z.string(), text: z.string() }).nullable() })) }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async ({ week: which }) => {
      const b = await bufferFor(auth, userId);
      const tz = b.timeZone;
      const range = weekRange(new Date(), tz, which === "this" ? 0 : 1);
      const week = weekFromBuffer(b.channels, postsBetween(b.posts, range.start, range.end), range, tz);
      const rows = slotRows(week);
      const lines = rows.map(({ c, day, t, p }) => `${week.days[day]} ${t} · ${c.name}${c.isDisconnected ? " (disconnected)" : ""} · ${p ? `${p.status} (post id ${p.id}): ${p.text}` : "EMPTY"}`);
      // Buffer reports a paused queue but offers no way to resume it, so the person must do that in Buffer.
      const paused = b.channels.filter((c) => c.isQueuePaused).map((c) => `${c.name}'s queue is paused in Buffer, so its scheduled posts will not go out until the person resumes it in Buffer.`);
      const slots = rows.map(({ c, day, t, p }) => ({ day: week.days[day], time: t, channelId: c.id, channel: c.name, disconnected: !!c.isDisconnected, post: p ? { id: p.id, status: p.status, text: p.text } : null }));
      return typed(`${week.label}\n${[...paused, ...lines].join("\n") || "No posting slots set in Buffer."}${asOf(b.fetchedAt)}`,
        { label: week.label, asOf: b.fetchedAt.toISOString(), paused: b.channels.filter((c) => c.isQueuePaused).map((c) => c.name), slots });
    },
  );

  registerGuardedTool(server, 
    "show_last_week_delivery",
    {
      title: "Show last week's delivery",
      description: "Use this when the user asks what went out or what failed. It lists posts that were due in the last 7 days and whether each one was sent. For a failed post it gives Buffer's own reason.",
      outputSchema: z.object({ asOf: z.string(), posts: z.array(z.object({ id: z.string(), at: z.string(), channel: z.string(), title: z.string(), sent: z.boolean(), error: z.string().nullable() })) }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const b = await bufferFor(auth, userId);
      const now = new Date();
      const range = { start: new Date(now.getTime() - 7 * 86_400_000), end: now };
      const items = deliveriesFromBuffer(b.channels, postsBetween(b.posts, range.start, range.end), range, now);
      const data = { asOf: b.fetchedAt.toISOString(), posts: items.map((i) => ({ id: i.id, at: i.at, channel: i.channel, title: i.title, sent: i.tone === "success", error: i.error?.message ?? null })) };
      if (items.length === 0) return typed(`No posts were due in the last 7 days.${asOf(b.fetchedAt)}`, data);
      return typed(items.map((i) => `${i.at} · ${i.channel} · ${i.title}${i.error ? ` · Buffer says: ${i.error.message}` : ""}`).join("\n") + asOf(b.fetchedAt), data);
    },
  );

  registerGuardedTool(server, 
    "list_open_slots",
    {
      title: "List empty slots",
      description:
        "Use this after get_my_voice, get_playbook and read_material, before writing drafts. It lists every empty posting slot in the user's Buffer queue for the next 14 days. Each slot has a slot id, the local date and time with its timezone, the channel, the network and its character limit. Pass the slot id to save_drafts. Channels Buffer cannot post to right now are listed separately with the reason. Slot ids are only valid until the slot is filled.",
      outputSchema: z.object({ asOf: z.string(), slots: z.array(z.object({ id: z.string(), at: z.string(), local: z.string(), timezone: z.string(), channelId: z.string(), channel: z.string(), service: z.string(), maxChars: z.number().int().nullable() })), skipped: z.array(z.object({ channel: z.string(), reason: z.string() })), note: z.string().nullable() }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async () => {
      const b = await bufferFor(auth, userId);
      const { slots, skipped } = openSlots(b.channels, b.posts, b.range);
      const lines = slots.map((x) => `${x.id} · ${x.local} ${x.timezone} · ${x.channel} (${x.service}${limitFor(x.service) ? `, max ${limitFor(x.service)} chars` : ""})`);
      const skip = skipped.map((x) => `${x.channel}: ${x.reason}`);
      return typed(
        `${slots.length} empty slot${slots.length === 1 ? "" : "s"} in the next 14 days.\n${lines.join("\n")}` +
          (skip.length ? `\nNot drafting for: ${skip.join("; ")}` : "") +
          (b.range.note ? `\n${b.range.note}` : "") +
          asOf(b.fetchedAt),
        {
          asOf: b.fetchedAt.toISOString(), note: b.range.note ?? null,
          slots: slots.map((x) => ({ id: x.id, at: x.at, local: x.local, timezone: x.timezone, channelId: x.channelId, channel: x.channel, service: x.service, maxChars: limitFor(x.service) ?? null })),
          skipped: skipped.map((x) => ({ channel: x.channel, reason: x.reason })),
        },
      );
    },
  );
}

/** Saving new drafts and changing one. */
export function registerDraftWrites(c: McpContext): void {
  const { server, auth, userId } = c;
  registerGuardedTool(server, 
    "save_drafts",
    {
      title: "Save drafts to Buffer",
      description:
        "Saves your drafts into empty Buffer slots as Buffer drafts. This tool cannot schedule or publish; approve_drafts does that, only when the user asks. Call it only after the user has seen the drafts and said they are fine. Use slot ids from list_open_slots. Read get_my_voice and get_playbook before writing. Each draft must match that voice, fit its network's limit and follow the playbook. A slot filled since you listed it is refused, and so is a slot that would pass the channel's daily limit. The answer lists every refused slot with the reason: fix those and send only those again. The others were saved. For source-backed drafts, evidence.claim must copy the exact sentence or phrase from the draft, and evidence.quote must copy the saved source word for word. Never paraphrase these fields. Evidence warnings can be repaired with update_draft without creating duplicates.",
      inputSchema: z.object({
        title: z.string().min(1).max(200).describe("What these posts are about, e.g. the release or article they come from."),
        drafts: z.array(z.object({ slotId: z.string().describe("A slot id from list_open_slots."), text: z.string().min(1).max(25_000).describe("The post text. It must fit the slot's character limit."), snapshotId: z.string().max(100).optional().describe("Snapshot ID returned by read_material, get_transcript or add_web_page"), evidence: z.array(evidenceInput).max(8).optional() })).min(1).max(50),
        sourceKeys: z.array(z.string().max(2000)).max(20).optional().describe("Keys of the list_new_material items these drafts are about; they are marked as used once a draft is saved."),
      }),
      outputSchema: z.object({ saved: z.array(z.object({ local: z.string(), channel: z.string(), postId: z.string().nullable() })), refused: z.array(z.object({ slotId: z.string(), reason: z.string() })), flags: z.array(z.object({ slotId: z.string(), rule: z.string(), verdict: z.string(), reason: z.string().nullable() })), requests: z.number().int() }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    async ({ title, drafts, sourceKeys }) => {
      // Re-read the queue right now, so a slot filled since list_open_slots is refused instead of double-booked.
      const b = await bufferFor(auth, userId, { force: true });
      const { slots } = openSlots(b.channels, b.posts, b.range);
      const res = await saveDraftsForUser(userId, b.accessToken, { title, drafts, open: slots, sourceKeys });
      // The post id lets the AI change, delete or approve this draft without another read, whichever week it is in.
      const saved = res.saved.map((x) => `Saved: ${x.local} · ${x.channel}${x.postId ? ` · post id ${x.postId}` : ""}`);
      const refused = res.refused.map((x) => `Not saved: ${x.slotId} · ${x.reason}`);
      const notes = res.flags.map((f) => `Saved, but check: ${f.slotId} · ${f.verdict === "fail" ? `breaks "${f.rule}"` : `unsure about "${f.rule}"`}${f.reason ? `: ${f.reason}` : ""}`);
      const judged = res.check === "judged" && res.judgedWith ? [`Checked against the user's playbook by a model (${res.judgedWith}).`] : [];
      const uncheckedNote = checkNote(res.check);
      const unchecked = uncheckedNote ? [uncheckedNote] : [];
      const answer = typed([`${res.saved.length} saved, ${res.refused.length} not saved, as Buffer drafts (${res.requests} request${res.requests === 1 ? "" : "s"}).`, ...saved, ...notes, ...refused, ...judged, ...unchecked].join("\n"), {
        saved: res.saved.map((x) => ({ local: x.local, channel: x.channel, postId: x.postId ?? null })),
        refused: res.refused.map((x) => ({ slotId: x.slotId, reason: x.reason })),
        flags: res.flags.map((f) => ({ slotId: f.slotId, rule: f.rule, verdict: f.verdict, reason: f.reason ?? null })),
        requests: res.requests,
      });
      // A completed playbook refusal is a normal verdict. Actual save failures still report an error.
      const failed = res.refused.some(r => !r.reason.startsWith(PLAYBOOK_REFUSAL));
      return failed ? { ...answer, isError: true } : answer;
    },
  );

  registerGuardedTool(server, 
    "update_draft",
    {
      title: "Change a draft",
      description:
        "Replaces the text of one draft in the user's Buffer queue. The old text is gone after this. Use a post id from show_next_week. The post stays a draft in the same slot. Only drafts can be changed: an approved, scheduled or sent post is refused. Only drafts this app wrote can be changed. Read get_my_voice and get_playbook before rewriting. The new text must fit the network's limit and follow the playbook. If it cites saved source evidence, check that evidence again with report_source_version before approval. To repair citation fields only, supply snapshotId and evidence, with the current unchanged text in both text and expectedText. This replaces evidence for that attached snapshot without editing Buffer or creating another draft. It requires exact draft claims and source quotes and rejects outdated sources.",
      inputSchema: z.object({ postId: z.string().min(1).max(200).describe("A post id from show_next_week."), text: z.string().min(1).max(25_000).describe("The full new text of the post."), expectedText: z.string().max(25_000).optional().describe("Exact text read before proposing this edit. A newer edit in Buffer is refused, never overwritten. Required for evidence repair."), snapshotId: z.string().min(1).max(100).optional().describe("For evidence repair only: the current source snapshot already attached to this draft."), evidence: z.array(evidenceInput).min(1).max(8).optional().describe("For evidence repair only: all replacement claims and quotes for this snapshot. Keep text unchanged and provide expectedText.") }),
      outputSchema: z.object({ postId: z.string(), updated: z.literal(true), evidenceRepaired: z.boolean(), checkNote: z.string().nullable() }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ postId, text: newText, expectedText, snapshotId, evidence }) => {
      const b = await bufferFor(auth, userId, { force: true });
      if (snapshotId !== undefined || evidence !== undefined) {
        if (!snapshotId || !evidence?.length || expectedText === undefined) return { ...text("Not changed: evidence repair requires snapshotId, evidence and expectedText. Keep the draft text unchanged."), isError: true };
        const repaired = await repairDraftEvidence(userId, b.accessToken, { postId, text: newText, expectedText, snapshotId, evidence }, b.posts, await wroteIds(userId, postId));
        return repaired.ok ? typed("Source quotes repaired on the existing draft. Its text, slot and draft status are unchanged. Quote matching is not a new AI check of meaning.", { postId, updated: true as const, evidenceRepaired: true, checkNote: null }) : { ...text(`Not changed: ${repaired.reason}`), isError: true };
      }
      let note: string | undefined;
      let check: Awaited<ReturnType<typeof judgeEdit>> | undefined;
      let editedNetwork = "";
      const r = await updateDraft(b.accessToken, postId, newText, b.posts, b.channels, await wroteIds(userId, postId), undefined, async (t, network, channelId) => {
        editedNetwork = network;
        check = await judgeEdit(userId, t, network, channelId);
        note = checkNote(check.check);
        return check.refusal;
      }, expectedText);
      if (!r.ok) return { ...text(`Not changed: ${r.reason}`), isError: true };
      // The connected AI revising its own draft is the writer, not the person fixing it: when the person had not changed
      // the draft, its text becomes what Queue Pilot wrote, so the AI's change never counts toward "You made the same
      // fix twice". When the person had already fixed it, what Queue Pilot wrote is kept, so their fix stays an edit,
      // and the AI's text is stored only as the checked text.
      const before = b.posts.find((p) => p.id === postId)?.text ?? "";
      const recorded = (await postgresWrittenStore().get(userId, [postId]).catch(() => []))[0];
      const entry = { postId, network: editedNetwork, text: newText, verdicts: check?.verdicts ?? null, playbookRevision: check?.playbookRevision ?? null };
      await (recorded && recorded.text !== before ? postgresWrittenStore().recordCheck(userId, [entry]) : postgresWrittenStore().record(userId, [entry])).catch((e: unknown) => console.error(JSON.stringify({ event: "qp-connector-edit-not-recorded", message: e instanceof Error ? e.message : String(e) })));
      await patchSnapshot(userId, (posts) => posts.map((p) => (p.id === postId ? { ...p, text: newText } : p)));
      return typed(`Draft updated. It is still a draft until it is approved.${note ? `\n${note}` : ""}`, { postId, updated: true as const, evidenceRepaired: false, checkNote: note ?? null });
    },
  );
}

/** Deleting a draft, moving a post back to draft, and approving drafts. */
export function registerDraftMoves(c: McpContext): void {
  const { server, auth, userId, app, byApp } = c;
  registerGuardedTool(server, 
    "delete_draft",
    {
      title: "Delete a draft",
      description:
        "Deletes one draft from the user's Buffer queue and leaves its slot empty. This cannot be undone. Ask the user before you call it. Use a post id from show_next_week. Only drafts this app wrote can be deleted. An approved, scheduled or sent post is refused.",
      inputSchema: z.object({ postId: z.string().min(1).max(200).describe("A post id from show_next_week.") }),
      outputSchema: z.object({ postId: z.string(), deleted: z.literal(true) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
    },
    async ({ postId }) => {
      const b = await bufferFor(auth, userId, { force: true });
      const slot = draftSlot(b.posts.find((p) => p.id === postId), b.channels);
      const r = await deleteDraft(b.accessToken, postId, b.posts, await wroteIds(userId, postId));
      if (!r.ok) return { ...text(`Not deleted: ${r.reason}`), isError: true };
      await patchSnapshot(userId, (posts) => posts.filter((p) => p.id !== postId));
      await recordAction(userId, "draft_deleted", await byApp(), { ids: [postId], slots: [slot] });
      return typed("Draft deleted; its slot is empty again.", { postId, deleted: true as const });
    },
  );

  registerGuardedTool(server, 
    "move_back_to_draft",
    {
      title: "Take a post off the schedule",
      description:
        "Takes one scheduled post off the schedule in Buffer and keeps it as a draft, with its text and time unchanged. Use it when the user asks to stop a post from going out. Only posts this app wrote; a post already sending or sent is left. A post moved back can be scheduled again only by the user, in Queue Pilot.",
      inputSchema: z.object({ postId: z.string().min(1).max(200).describe("A post id from show_next_week.") }),
      outputSchema: z.object({ postId: z.string(), status: z.literal("draft") }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    async ({ postId }) => {
      const b = await bufferFor(auth, userId, { force: true });
      if (!b.posts.some((p) => p.id === postId)) return { ...text("Not changed: no such post in the user's queue. Use a post id from show_next_week."), isError: true };
      const slot = draftSlot(b.posts.find((p) => p.id === postId), b.channels);
      const r = await moveToDraft(b.accessToken, postId, undefined, await wroteIds(userId, postId));
      if (!r.ok) return { ...text(`Not changed: ${r.reason}`), isError: true };
      await patchSnapshot(userId, (posts) => posts.map((p) => (p.id === postId ? { ...p, status: "draft" as const } : p)));
      await recordAction(userId, "moved_to_draft", await byApp(), { ids: [postId], slots: [slot] });
      return typed("Taken off the schedule; it is a draft in Buffer now and will not post. Only the user can schedule it again.", { postId, status: "draft" as const });
    },
  );

  registerGuardedTool(server, 
    "approve_drafts",
    {
      title: "Approve drafts",
      description:
        "Schedules drafts in the user's Buffer at their slot times, so they go out publicly. Never approve on your own: only when the user asks. Use post ids from save_drafts, show_next_week or list_my_drafts. The user decides in Queue Pilot Settings whether you must ask first. When asking is on, the first call changes nothing and returns the drafts plus a confirmToken: show the user every draft's text, account and time, ask for a clear yes, and only then call again with the same postIds and the confirmToken. A token works once; if a draft changed or the user changed their setting, show the drafts again. Never invent or reuse a yes. Drafts whose playbook check is out of date or that break a blocking rule are refused. Only drafts this app wrote can be approved, at most 25 at a time.",
      inputSchema: z.object({
        postIds: z.array(z.string().min(1).max(200)).min(1).max(MAX_APPROVE).describe("Post ids from show_next_week."),
        confirmToken: z.string().max(10_000).optional().describe("Only after the user said yes to exactly these drafts."),
      }),
      // Scheduling makes posts public and a second call can schedule more, so it is neither harmless nor repeatable.
      outputSchema: z.object({ status: z.enum(["needs_confirmation", "scheduled"]).describe("needs_confirmation: nothing was scheduled; show the drafts and ask, then call again with confirmToken"), confirmToken: z.string().nullable(), drafts: z.array(z.object({ postId: z.string(), found: z.boolean() })), approved: z.array(z.string()), refused: z.array(z.object({ postId: z.string(), reason: z.string() })) }),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ postIds, confirmToken }) => {
      const { mode, revision } = await approvePermission(userId);
      if (mode === "off") return { ...text("The user approves drafts themselves. They turned approving from connected apps off in Queue Pilot Settings. Point them to Next week."), isError: true };
      const b = await bufferFor(auth, userId, { force: true });
      const names = new Map(b.channels.map((c) => [c.id, c.name]));
      // Each draft as Buffer has it right now, not the saved copy: the yes covers exactly this text, account and time.
      const fresh = await readPostsNow(b.accessToken, postIds);
      const byId = new Map(fresh.map((p) => [p.id, p]));
      const shown = postIds.map((id) => byId.get(id) ?? { id, channelId: "", text: "", dueAt: null, assets: [] });
      let claim: { nonce: string; expires: number } | null = null;
      if (mode === "ask") {
        if (!confirmToken) {
          const lines = postIds.map((id) => { const p = byId.get(id); return p ? `- ${id} · ${names.get(p.channelId) ?? "account"} · ${p.dueAt ?? "no time"}\n  ${p.text}` : `- ${id} · not found in the queue`; });
          const confirm = signApproval(userId, shown, revision);
          return typed([`Nothing approved yet. Show the user these ${postIds.length} draft${postIds.length === 1 ? "" : "s"} and ask whether to schedule them. Only after a clear yes, call approve_drafts again with the same postIds and this confirmToken (valid 10 minutes, usable once):`, `confirmToken: ${confirm}`, ...lines].join("\n"), { status: "needs_confirmation" as const, confirmToken: confirm, drafts: postIds.map((id) => ({ postId: id, found: byId.has(id) })), approved: [], refused: [] });
        }
        claim = verifyApproval(userId, shown, confirmToken, revision);
        if (!claim) return { ...text("That confirmation no longer matches: a draft changed, the time passed, or the user changed their setting. Nothing was scheduled. Show the drafts again and ask."), isError: true };
      }
      // Scheduling writes to Buffer, so it shares the person's Buffer write allowance with the app.
      const l = await limit("bufferWrite", userId);
      if (!l.ok) return { ...text(`Too many requests just now. Try again in ${Math.max(1, Math.ceil(l.resetSeconds / 60))} min.`), isError: true };
      if (claim && !(await claimApproval(userId, claim.nonce, claim.expires))) return { ...text("That yes was already used. Nothing more was scheduled. Show the drafts again and ask."), isError: true };
      const res = await approveChecked(userId, b.accessToken, postIds, new Date(), undefined, fresh, b.channels, "ai");
      // A yes that scheduled nothing can be tried again; one that scheduled anything is spent.
      if (claim && res.approved.length === 0 && !res.uncertain?.length) await releaseApproval(userId, claim.nonce);
      const done = new Set(res.approved);
      if (done.size) await recordApprover(userId, res.approved, approverFor(await app()));
      if (done.size) await patchSnapshot(userId, (posts) => posts.map((p) => (done.has(p.id) ? { ...p, status: "scheduled" as const } : p)));
      if (done.size) await recordAction(userId, "drafts_approved", await byApp(), { ids: res.approved, slots: res.approved.map((id) => draftSlot(b.posts.find((p) => p.id === id), b.channels)) });
      const answer = typed([`${res.approved.length} scheduled in Buffer, ${res.refused.length} not.`, ...res.refused.map((r) => `Not scheduled: ${r.id} · ${r.reason}`)].join("\n"),
        { status: "scheduled" as const, confirmToken: null, drafts: postIds.map((id) => ({ postId: id, found: byId.has(id) })), approved: res.approved, refused: res.refused.map((r) => ({ postId: r.id, reason: r.reason })) });
      return res.approved.length === 0 ? { ...answer, isError: true } : answer;
    },
  );
}
