/**
 * @fileoverview Promotion attempts: the fingerprint ignores version order and spacing but not account or wording, and
 * a recorded attempt stays recorded until a new attempt replaces it.
 */
import { describe, expect, it } from "vitest";
import { memoryPromotionAttempts, promotionFingerprint } from "./promotion-attempts";

describe("promotion fingerprint", () => {
  it("ignores order and spacing, but not the account or the words", () => {
    const a = promotionFingerprint([{ channelId: "x", text: "Soup  night." }, { channelId: "li", text: "Soup night, long." }]);
    expect(promotionFingerprint([{ channelId: "li", text: " Soup night, long. " }, { channelId: "x", text: "Soup night." }])).toBe(a);
    expect(promotionFingerprint([{ channelId: "x", text: "Soup night!" }, { channelId: "li", text: "Soup night, long." }])).not.toBe(a);
    expect(promotionFingerprint([{ channelId: "y", text: "Soup  night." }, { channelId: "li", text: "Soup night, long." }])).not.toBe(a);
  });
});

describe("promotion attempts", () => {
  it("records once, and a new attempt for the item starts unrecorded", async () => {
    const store = memoryPromotionAttempts();
    expect(await store.get("u", "ci")).toBeNull();
    await store.start("u", "ci", "f1");
    await store.markRecorded("u", "ci");
    expect((await store.get("u", "ci"))?.recordedAt).toBeInstanceOf(Date);
    await store.start("u", "ci", "f2");
    expect(await store.get("u", "ci")).toEqual({ fingerprint: "f2", recordedAt: null });
    expect(await store.get("other", "ci")).toBeNull();
  });
});
