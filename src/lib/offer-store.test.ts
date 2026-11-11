/**
 * @fileoverview Home's offers a person set aside (the first-run welcome, the connect-your-AI card): only known offers
 * are stored, setting one aside twice is harmless, each person sees only their own, and they go with the account.
 */
import { migratedPglite } from "@/test/migrated-pglite";
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// Real Postgres (PGLite) with the real migrations, behind the app's Drizzle client.
const pg = await migratedPglite();
const testDb = drizzle(pg, { schema: { ...(await import("../db/schema")), ...(await import("../db/auth-schema")) } });
vi.mock("../db", () => ({ db: () => testDb, schema: {} }));

const { dismissOffer, dismissedOffers, isOfferKey } = await import("./offer-store");

beforeEach(async () => {
  await pg.query(`delete from "user"`);
  await pg.query(`insert into "user" (id, name, email) values ('a', 'a', 'a@x'), ('b', 'b', 'b@x')`);
});
afterAll(async () => { await pg.close(); });

describe("offer store", () => {
  it("knows only Home's own offers", () => {
    expect(isOfferKey("welcome")).toBe(true);
    expect(isOfferKey("connect-ai")).toBe(true);
    expect(isOfferKey("add-ai")).toBe(true);
    expect(isOfferKey("anything")).toBe(false);
  });

  it("remembers an offer set aside, once, for that person only", async () => {
    await dismissOffer("a", "welcome");
    await dismissOffer("a", "welcome");
    expect([...await dismissedOffers("a")]).toEqual(["welcome"]);
    expect([...await dismissedOffers("b")]).toEqual([]);
  });

  it("goes with the account", async () => {
    await dismissOffer("a", "connect-ai");
    await pg.query(`delete from "user" where id = 'a'`);
    expect((await pg.query(`select 1 from qp_offer_dismissed`)).rows).toHaveLength(0);
  });
});
