/**
 * @fileoverview One inbox, one account: the canonical rule, and the lookup on the migrated database.
 */
import { drizzle } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { migratedPglite } from "@/test/migrated-pglite";

vi.mock("server-only", () => ({}));
const pg = await migratedPglite();
const testDb = drizzle(pg);
vi.mock("../db", () => ({ db: () => testDb }));
const { canonicalEmail, inboxTaken } = await import("./canonical-email");

describe("canonicalEmail", () => {
  it.each([
    ["A.D.A+test@GMAIL.com", "ada@gmail.com"],
    ["ada@googlemail.com", "ada@gmail.com"],
    ["ada+news@example.com", "ada@example.com"],
    ["a.da@example.com", "a.da@example.com"],
    [" ada@example.com. ", "ada@example.com"],
  ])("%s reaches %s", (raw, canon) => expect(canonicalEmail(raw)).toBe(canon));
  it("never merges catch-all addresses that start with +", () => {
    expect(canonicalEmail("+a@example.com")).not.toBe(canonicalEmail("+b@example.com"));
  });
});

describe("inboxTaken", () => {
  beforeAll(async () => {
    await pg.exec(`insert into "user" (id, name, email, email_verified, created_at, updated_at) values
      ('v1','V','ada@gmail.com',true,now(),now()),
      ('u1','U','ada+old@example.com',false,now(),now())`);
  });
  afterAll(async () => { await pg.close(); });
  it("is true for a variant of a verified account's inbox", async () => {
    expect(await inboxTaken("a.da+x@googlemail.com", "new")).toBe(true);
  });
  it("control: an unverified account blocks nobody, and an account never blocks itself", async () => {
    expect(await inboxTaken("ada@example.com", "new")).toBe(false);
    expect(await inboxTaken("ada@gmail.com", "v1")).toBe(false);
  });
});
