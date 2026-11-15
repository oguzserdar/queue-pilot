/**
 * @fileoverview Posting times for a directly connected account: what counts as a valid week of times, that only
 * the owner can set them, and that the accounts come back shaped like Buffer channels so the week's slot maths
 * is reused. Postgres is PGlite with the real migrations.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
vi.mock("../db", () => ({ db: () => testDb }));
const { parsePostingTimes, setPostingTimes, directChannels } = await import("./posting-times");
const { slotsInRange } = await import("./slots");

beforeAll(async () => {
  await pg.query(`insert into "user" (id, name, email) values ('u1', 'a', 'a@x'), ('u2', 'b', 'b@x')`);
  await pg.query(`insert into qp_social_account (id, user_id, network, account_id, handle, server, credentials) values
    ('a1', 'u1', 'mastodon', '1', '@ada@m.social', 'https://m.social', 'v1:x'),
    ('a2', 'u2', 'bluesky', 'did:plc:b', 'bo.bsky.social', 'https://bsky.social', 'v1:x')`);
});
afterAll(async () => { await pg.close(); });

describe("parsePostingTimes", () => {
  it("sorts and de-duplicates times, and keeps only days that have some", () => {
    expect(parsePostingTimes([{ day: "mon", times: ["17:30", "09:00", "09:00"] }, { day: "tue", times: [] }], "Europe/Istanbul")).toEqual({
      ok: true, schedule: [{ day: "mon", paused: false, times: ["09:00", "17:30"] }], timeZone: "Europe/Istanbul",
    });
  });
  it("refuses a time that is not HH:MM on the 24-hour clock", () => {
    expect(parsePostingTimes([{ day: "mon", times: ["25:00"] }], "UTC")).toMatchObject({ ok: false });
    expect(parsePostingTimes([{ day: "mon", times: ["9am"] }], "UTC")).toMatchObject({ ok: false });
  });
  it("refuses an unknown day or time zone", () => {
    expect(parsePostingTimes([{ day: "funday", times: ["09:00"] }], "UTC")).toMatchObject({ ok: false });
    expect(parsePostingTimes([{ day: "mon", times: ["09:00"] }], "Mars/Olympus")).toMatchObject({ ok: false });
  });
  it("caps a day at 12 times", () => {
    const times = Array.from({ length: 13 }, (_, i) => `${String(i + 8).padStart(2, "0")}:00`);
    expect(parsePostingTimes([{ day: "mon", times }], "UTC")).toMatchObject({ ok: false });
  });
});

describe("setPostingTimes and directChannels", () => {
  it("saves the owner's times and returns the account shaped like a channel, with its slots", async () => {
    const parsed = parsePostingTimes([{ day: "mon", times: ["09:00"] }], "UTC");
    if (!parsed.ok) throw new Error(parsed.message);
    expect(await setPostingTimes("u1", "a1", parsed)).toBe("ok");
    const [ch] = await directChannels("u1");
    expect(ch).toMatchObject({ id: "direct:a1", name: "@ada@m.social", service: "mastodon", timezone: "UTC", isDisconnected: false, isQueuePaused: false });
    // Monday 16 Nov 2026, 09:00 UTC.
    const slots = slotsInRange(ch, new Date("2026-11-16T00:00:00Z"), new Date("2026-11-17T00:00:00Z"));
    expect(slots.map((s) => s.at)).toEqual(["2026-11-16T09:00:00.000Z"]);
  });
  it("refuses to set times on someone else's account, and lists only one's own", async () => {
    const parsed = parsePostingTimes([{ day: "mon", times: ["09:00"] }], "UTC");
    if (!parsed.ok) throw new Error(parsed.message);
    expect(await setPostingTimes("u1", "a2", parsed)).toBe("not-found");
    expect((await directChannels("u1")).map((c) => c.id)).toEqual(["direct:a1"]);
  });
  it("control: an account with no times yet has no slots", async () => {
    const [ch] = await directChannels("u2");
    expect(slotsInRange(ch, new Date("2026-11-16T00:00:00Z"), new Date("2026-11-23T00:00:00Z"))).toEqual([]);
  });
});
