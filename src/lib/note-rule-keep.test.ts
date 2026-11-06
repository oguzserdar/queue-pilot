/**
 * @fileoverview Keeping a rule offered from a teammate's note reads the notes again: a note deleted or edited since the
 * offer is never kept as a rule.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TeamNote } from "./note-feedback";

const added: unknown[] = [];
vi.mock("server-only", () => ({}));
vi.mock("./rules-store", () => ({ postgresRulesStore: () => ({ list: async () => [], dismissed: async () => new Set(), add: async (_u: string, r: unknown) => { added.push(r); return "r1"; } }) }));
const { applySuggestion, signSuggestion } = await import("./rule-suggestions");

const note: TeamNote = { key: "note:abc", postId: "p1", channelId: "c1", account: "Company", network: "linkedin", post: "Draft text", author: "Sam", at: "2026-11-01T21:05:00Z", text: "Always say QP." };
const fromNote = { key: "note:k", fixes: 0, rule: { kind: "guidance" as const, text: "Say QP.", channels: "all" as const, accountIds: ["c1"], level: "warn" as const }, evidence: { kind: "note", note: note.text, author: note.author, at: note.at, postId: note.postId, channelId: note.channelId } };

beforeEach(() => { vi.stubEnv("SESSION_SECRET", "test-key"); added.length = 0; });
afterEach(() => vi.unstubAllEnvs());

describe("keeping a note rule", () => {
  it("keeps it while the note is still on its post, unchanged", async () => {
    const r = await applySuggestion("a", signSuggestion("a", fromNote), "keep", undefined, async () => [note]);
    expect(r.ok).toBe(true);
    expect(added).toHaveLength(1);
  });

  it("refuses when the note was deleted or edited since it was offered", async () => {
    for (const notes of [[], [{ ...note, text: "Never say QP." }], [{ ...note, postId: "p2" }]]) {
      const r = await applySuggestion("a", signSuggestion("a", fromNote), "keep", undefined, async () => notes);
      expect(r).toMatchObject({ ok: false, message: expect.stringMatching(/note/i) });
    }
    expect(added).toHaveLength(0);
  });

  it("refuses when the notes cannot be read again", async () => {
    expect((await applySuggestion("a", signSuggestion("a", fromNote), "keep")).ok).toBe(false);
    expect((await applySuggestion("a", signSuggestion("a", fromNote), "keep", undefined, async () => { throw new Error("Buffer down"); })).ok).toBe(false);
    expect(added).toHaveLength(0);
  });

  it("does not read the notes for other suggestions", async () => {
    const read = vi.fn(async () => []);
    const fromEdits = { ...fromNote, key: "fix:k", evidence: { fix: {}, count: 2 } };
    expect((await applySuggestion("a", signSuggestion("a", fromEdits), "keep", undefined, read)).ok).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });
});
