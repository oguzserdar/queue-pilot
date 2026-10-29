import { Pool } from "pg";
import { describe, expect, it } from "vitest";
import { attachDatabasePool } from "@vercel/functions";

describe("Vercel pool hook", () => {
  it("accepts the real pg Pool the app creates (no connection is opened)", async () => {
    const pool = new Pool({ connectionString: "postgres://u:p@127.0.0.1:1/none", max: 3, idleTimeoutMillis: 20_000 });
    expect(() => attachDatabasePool(pool)).not.toThrow();
    await pool.end();
  });
});
