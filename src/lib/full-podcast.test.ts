/** Real transport parsing, SQL storage, writer, Buffer-save payload and citation readback.
 * Provider and Buffer HTTP responses are fixtures, not a live account demonstration.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { answering, sentText } from "./ai-test-model";
import { fetchTranscript } from "./transcripts";
import { writeDrafts } from "./ai-writer";
import { sourceTimestamp } from "./source-labels";
import { verifyEvidence } from "./source-evidence";
import type { OpenSlot } from "./open-slots";
import type { Post } from "./buffer/queries";
const pg = await migratedPglite(); const testDb = drizzle(pg);
vi.mock("../db", () => ({ db: () => testDb }));
const fake = vi.hoisted(() => ({ query: vi.fn(), owned: vi.fn(), model: null as unknown, giveBack: vi.fn(), settle: vi.fn() }));
vi.mock("./buffer/client", async original => ({ ...await original<typeof import("./buffer/client")>(), bufferQuery: fake.query }));
vi.mock("./rules-store", () => ({ postgresRulesStore: () => ({ list: async () => [] }) }));
vi.mock("./sources-store", () => ({ postgresSourceStore: () => ({ list: async () => [], markUsed: async () => {} }) }));
vi.mock("./written-store", () => ({ postgresWrittenStore: () => ({ record: fake.owned }) }));
vi.mock("./buffer/snapshot-store", () => ({ postgresSnapshotStore: () => ({ get: async () => null }) }));
vi.mock("./judge-model", () => ({ aiFor: async () => ({ language: fake.model, giveBack: fake.giveBack, settle: fake.settle }), AiCapError: class extends Error {} }));
vi.mock("./rate-limit", () => ({ limit: async () => ({ ok: true }) }));
const store = await import("./source-store");
const { saveDraftsForUser } = await import("./save-for-user");
const { sourceCards } = await import("./source-presentation");
const { reportSourceVersion } = await import("./source-check");
const url = "https://www.youtube.com/watch?v=podcast123";
const quote = "The final experiment reduced review time from nine days to three days.";
const content = [...Array.from({ length: 718 }, (_, i) => ({ text: `At section ${i} we discuss research methods and the constraints of measurement. ` + "This is background material for the experiment. ".repeat(4), offset: i * 10_000 })),
  { text: "The final experiment reduced review time", offset: 7_190_000 }, { text: "from nine days to three days.", offset: 7_194_000 }];
const slot: OpenSlot = { id: "ch@2099-01-01T12:00:00.000Z", channelId: "ch", channel: "Personal", service: "linkedin", organizationId: "org", at: "2099-01-01T12:00:00.000Z", local: "Thu 12:00", timezone: "UTC" };
beforeAll(async () => {
 await pg.query(`insert into "user" (id,name,email) values ('owner','Owner','owner@test'),('other','Other','other@test')`);
 fake.owned.mockResolvedValue(undefined); fake.giveBack.mockResolvedValue(undefined); fake.settle.mockResolvedValue(undefined);
 fake.query.mockImplementation(async (_token, query) => query.includes("dailyPostingLimits") ? { dailyPostingLimits: [] } : { createContentItem: { __typename: "CreateContentItemSuccess", content: { id: "ci", body: { __typename: "PostContent", posts: [{ id: "podcast-post", channelId: "ch" }] } } } });
});
afterAll(() => pg.close());
it("saves a 1:59:50 closing quote as a draft, retains both captions, and detects a later closing correction", async () => {
 const result = await fetchTranscript(url, "fixture-key", undefined, vi.fn(async () => new Response(JSON.stringify({ content }))));
 expect(result.status).toBe("ready"); if (result.status !== "ready") throw new Error("not ready");
 expect(result.text.length).toBeGreaterThan(150_000); expect(result.text.endsWith(quote)).toBe(true); expect(result.truncated).toBe(false);
 const snapshot = await store.captureSource("owner", { sourceKey: "yt:podcast123", uri: url, text: result.text }, { kind: "transcript", segments: result.segments, truncated: false });
 expect((await store.sourceById("owner", snapshot.id))?.text).toBe(result.text);
 expect(await store.sourceById("other", snapshot.id)).toBeNull();
 const text = `${quote} ${url}&t=7190`;
 const model = answering({ drafts: [{ slotId: slot.id, sourceKey: snapshot.sourceKey, fit: [], text, evidence: [{ claim: quote, quote, locator: "t=7190" }] }] });
 const drafts = await writeDrafts(model, { slots: [{ ...slot }], material: [{ key: snapshot.sourceKey, title: "Two-hour research interview", url, text: result.text, segments: result.segments }], voice: { note: "Plain, specific.", examples: [] }, rules: [] });
 expect(sentText(model)).toContain("from nine days to three days.");
 const saved = await saveDraftsForUser("owner", "fixture-token", { title: "Closing finding", drafts: drafts.map(d => ({ ...d, snapshotId: snapshot.id })), open: [slot] });
 expect(saved.saved).toHaveLength(1); expect(saved.flags).toEqual([]);
 const write = fake.query.mock.calls.find(c => c[1].includes("createContentItem"))!;
 expect(write[2].input.posts[0]).toMatchObject({ text, saveToDraft: true });
 const [evidence] = await store.evidenceForPosts("owner", ["podcast-post"]);
 expect(evidence).toMatchObject({ quote, locator: "t=7190" });
 expect(sourceTimestamp(evidence.locator!)).toBe("1:59:50");
 expect(verifyEvidence(text, result.text, { claim: quote, quote, locator: "t=10" }, { segments: result.segments }).locator).toBeNull();
 const post: Post = { id: "podcast-post", channelId: "ch", text, status: "draft", dueAt: slot.at, sentAt: null, externalLink: null, error: null };
 const [card] = await sourceCards("owner", [post]);
 expect(card).toMatchObject({ uri: url, locator: "t=7190", needsCheck: false, truncated: false });
 const corrected = result.text.replace("from nine days to three days.", "from nine days to five days.");
 const checkModel = answering({ verdicts: [{ index: 0, holds: false, why: "The closing finding now says five days.", rewrite: text.replace("three days", "five days") }] }); fake.model = checkModel;
 const checked = await reportSourceVersion("owner", { sourceKey: snapshot.sourceKey, uri: url, text: corrected, checkedBy: "test" }, async () => [post], { kind: "transcript", truncated: false });
 expect(checked).toMatchObject({ changed: true, proposals: 1, pending: 0 });
 expect(sentText(checkModel)).toContain("from nine days to five days.");
 expect((await store.sourceHoldsForPosts("owner", [post])).has(post.id)).toBe(true);
 expect(post.text).toBe(text);
});

it("can read the closing passage from the saved full transcript without replacing it", async () => {
 const { transcriptSelection } = await import("./transcript-selection");
 const snapshot = (await store.latestSource("owner", "yt:podcast123"))!;
 // The previous test changed the source, so capture a separate timestamped transcript here.
 const original = await store.captureSource("owner", { sourceKey: "yt:selection", uri: url, text: "Intro. " + quote }, { kind: "transcript", truncated: false, segments: [{ text: "Intro.", seconds: 0 }, { text: quote, seconds: 7190 }] });
 const selected = transcriptSelection(original, 7190);
 expect(selected).toMatchObject({ text: quote, truncated: true, snapshotId: original.id, coverage: { fullTranscriptSaved: true, selection: { startSeconds: 7190, endSeconds: null } } });
 expect((await store.sourceById("owner", original.id))?.text).toBe("Intro. " + quote);
 expect(() => transcriptSelection(snapshot, 7190, 1)).toThrow("after the start");
});
