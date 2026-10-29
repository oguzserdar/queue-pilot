/**
 * What one full first session costs in Buffer requests, measured by running the real code against a fake Buffer that
 * counts calls. Buffer gives each app 500 requests a day plus 25 for each Buffer account that has signed in to it
 * (developers.buffer.com/guides/api-limits, read 27 Oct 2026), so a session must cost less than the 25 it adds.
 * The README quotes this number.
 */
import { describe, expect, it } from "vitest";
import type { bufferQuery } from "./buffer/client";
import { memorySnapshotStore, refreshSnapshot } from "./buffer/snapshot";
import { updateDraft } from "./edit-drafts";
import type { OpenSlot } from "./open-slots";
import { saveDrafts } from "./save-drafts";

const T0 = new Date("2026-11-02T08:00:00Z");
const at = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);
const CHANNELS = [
  { id: "x", name: "X", service: "twitter" },
  { id: "li", name: "LinkedIn", service: "linkedin" },
  { id: "bs", name: "Bluesky", service: "bluesky" },
];

/** A fake Buffer for one organization with three channels; every call is counted by its first word. */
function countingBuffer() {
  const calls: string[] = [];
  let next = 0;
  const query = (async (_t: string, text: string) => {
    const op = text.match(/\b(account|channels|posts|dailyPostingLimits|createContentItem|createPost|editPost)\b/)?.[1] ?? "other";
    calls.push(op);
    if (op === "account") return { account: { email: "judge@x", organizations: [{ id: "o1" }] } };
    if (op === "channels") return { channels: CHANNELS };
    if (op === "posts") return { posts: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } };
    if (op === "dailyPostingLimits") return { dailyPostingLimits: [] };
    if (op === "createContentItem") return { createContentItem: { __typename: "CreateContentItemSuccess", content: { id: `c${next++}`, body: { posts: [] } } } };
    if (op === "editPost") return { editPost: { __typename: "PostActionSuccess" } };
    throw new Error(`unexpected ${op}`);
  }) as unknown as typeof bufferQuery;
  return { query, calls };
}

/** A working week: one slot a day on each channel, Monday to Friday, at the same hour. */
const week: OpenSlot[] = [0, 1, 2, 3, 4].flatMap((d) =>
  CHANNELS.map((c) => {
    const when = new Date(Date.UTC(2026, 10, 3 + d, 14)).toISOString();
    return { id: `${c.id}@${when}`, channelId: c.id, channel: c.name, service: c.service, organizationId: "o1", at: when, local: when, timezone: "UTC" };
  }),
);

describe("a judge's first session", () => {
  it("costs 21 Buffer requests, less than the 25 a day each signed-in person adds to the app's limit", async () => {
    const store = memorySnapshotStore();
    const { query, calls } = countingBuffer();
    const signIn = 1; // Better Auth's getUserInfo asks Buffer for the account once (src/lib/auth.ts).

    // First page: no copy yet, so one refresh: account, channels, posts.
    await refreshSnapshot("judge", "t", { store, query, now: () => at(0) });
    const afterFirstPage = calls.length;

    // Browsing every screen reads the saved copy.
    for (let i = 1; i <= 5; i++) await refreshSnapshot("judge", "t", { store, query, now: () => at(i * 0.5) });
    expect(calls.length).toBe(afterFirstPage);

    // Write my week, two minutes in: a write refreshes first, then saves 15 drafts.
    await refreshSnapshot("judge", "t", { store, query, now: () => at(2) }, { force: true });
    const saved = await saveDrafts("t", { title: "Week", drafts: week.map((s) => ({ slotId: s.id, text: "A short post." })), open: week }, query);
    expect(saved.saved).toHaveLength(15);

    // Edit one draft at once: the copy is under 30 seconds old, so only the edit itself is a request.
    const snap = await refreshSnapshot("judge", "t", { store, query, now: () => at(2.2) }, { force: true });
    const post = { id: "p1", channelId: "x", status: "draft", text: "A short post.", dueAt: week[0].at, via: "api" } as never;
    expect((await updateDraft("t", "p1", "A shorter post.", [post], snap!.data.channels, new Set(["p1"]), query)).ok).toBe(true);

    // The Refresh button ten minutes later.
    await refreshSnapshot("judge", "t", { store, query, now: () => at(10) }, { force: true });

    const total = signIn + calls.length;
    expect({
      firstPage: 3,
      browsing: 0,
      writeWeek: calls.filter((c) => c === "dailyPostingLimits" || c === "createContentItem").length + 3,
      edit: 1,
      refresh: 3,
      total,
    }).toEqual({ firstPage: 3, browsing: 0, writeWeek: 13, edit: 1, refresh: 3, total: 21 });
    expect(total).toBeLessThan(25);
  });
});
