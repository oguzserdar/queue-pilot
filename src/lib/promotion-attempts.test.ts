/**
 * @fileoverview Promotion attempts: the fingerprint covers account, words, slot time, source and evidence but not
 * order or spacing; a pending attempt with different versions blocks a second claim until it is stale; only the
 * claiming token completes an attempt, so a late, older call never marks a newer attempt recorded.
 */
import { describe, expect, it } from "vitest";
import { memoryPromotionAttempts, promotionFingerprint, STALE_MS } from "./promotion-attempts";

describe("promotion fingerprint", () => {
  const base = [{ channelId: "x", text: "Soup  night." }, { channelId: "li", text: "Soup night, long.", snapshotId: "s1", evidence: [{ claim: "a", quote: "a" }] }];
  it("ignores order and spacing", () => {
    expect(promotionFingerprint([{ ...base[1], text: " Soup night, long. " }, { ...base[0], text: "Soup night." }])).toBe(promotionFingerprint(base));
  });
  it("changes with the account, the words, the slot time, the source or the evidence", () => {
    const f = promotionFingerprint(base);
    expect(promotionFingerprint([{ ...base[0], text: "Soup night!" }, base[1]])).not.toBe(f);
    expect(promotionFingerprint([{ ...base[0], channelId: "y" }, base[1]])).not.toBe(f);
    expect(promotionFingerprint([{ ...base[0], dueAt: "2026-11-10T09:00:00.000Z" }, base[1]])).not.toBe(f);
    expect(promotionFingerprint([base[0], { ...base[1], snapshotId: "s2" }])).not.toBe(f);
    expect(promotionFingerprint([base[0], { ...base[1], evidence: [{ claim: "a", quote: "b" }] }])).not.toBe(f);
  });
});

describe("promotion attempts", () => {
  const t0 = new Date("2026-11-05T09:00:00Z");

  it("refuses a different promotion while one is pending, allows the same versions, and lets a stale one go", async () => {
    const store = memoryPromotionAttempts();
    const first = await store.claim("u", "ci", "f1", t0);
    expect(first).toBeTruthy();
    expect(await store.claim("u", "ci", "f2", new Date(t0.getTime() + 60_000))).toBeNull();
    expect(await store.claim("u", "ci", "f1", new Date(t0.getTime() + 60_000))).toBeTruthy();
    expect(await store.claim("u", "ci", "f2", new Date(t0.getTime() + STALE_MS + 120_000))).toBeTruthy();
    expect(await store.claim("other", "ci", "f9", t0)).toBeTruthy();
  });

  it("completes only with the current token, so a late older call cannot mark a newer attempt recorded", async () => {
    const store = memoryPromotionAttempts();
    const old = (await store.claim("u", "ci", "f1", t0))!;
    const newer = (await store.claim("u", "ci", "f1", new Date(t0.getTime() + 1000)))!;
    await store.markRecorded("u", "ci", old);
    expect((await store.get("u", "ci"))?.recordedAt).toBeNull();
    await store.markRecorded("u", "ci", newer);
    expect((await store.get("u", "ci"))?.recordedAt).toBeInstanceOf(Date);
  });

  it("lets a new promotion replace a finished one", async () => {
    const store = memoryPromotionAttempts();
    const tok = (await store.claim("u", "ci", "f1", t0))!;
    await store.markRecorded("u", "ci", tok);
    expect(await store.claim("u", "ci", "f2", new Date(t0.getTime() + 1000))).toBeTruthy();
    expect((await store.get("u", "ci"))?.recordedAt).toBeNull();
  });
});
