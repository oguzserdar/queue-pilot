/**
 * @fileoverview Fill a week, reporting each draft as it is written.
 *
 * Answers with one JSON object per line: `start` (the times to be written), `draft` (one finished draft, already in
 * our own store), `saving` (the single Buffer save has begun) and `done` (the same result the button always showed).
 * The run does not stop when the page is closed: it finishes and saves, and the week shows the drafts on return.
 */
import { randomUUID } from "node:crypto";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { bufferForWriting } from "@/lib/current-user";
import { postgresFillDraftStore } from "@/lib/fill-draft-store";
import { writeSlotsForUser, type WriteWeekActionResult } from "@/lib/write-slots-for-user";

export const maxDuration = 300;

export async function POST(request: Request) {
  // A cookie-authenticated write: only our own pages may start it.
  const origin = request.headers.get("origin");
  const sameHost = (() => { try { return !!origin && new URL(origin).host === new URL(request.url).host; } catch { return false; } })();
  if (!sameHost) return new Response(null, { status: 403 });
  const body = await request.json().catch(() => null) as { week?: unknown } | null;
  const week = body?.week === "this" ? "this" : "next";

  const encoder = new TextEncoder();
  let send: (event: object) => void = () => {};
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // A closed page must not stop the run, so a failed write to the page is ignored.
      send = (event) => { try { controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`)); } catch { /* the page is gone */ } };
      const run = (async () => {
        let result: WriteWeekActionResult;
        try {
          result = await writeSlotsForUser(bufferForWriting, undefined, week, {
            runId: randomUUID(),
            store: postgresFillDraftStore(),
            onStart: (slotIds) => send({ type: "start", slotIds }),
            onDraft: (draft) => send({ type: "draft", ...draft }),
            onDropped: (slotId) => send({ type: "dropped", slotId }),
            onSaving: () => send({ type: "saving" }),
          });
        } catch {
          result = { ok: false, message: "Could not write the drafts just now. Try again." };
        }
        try { revalidatePath("/", "layout"); } catch { /* nothing to refresh */ }
        send({ type: "done", result });
        try { controller.close(); } catch { /* already closed */ }
      })();
      after(() => run);
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
