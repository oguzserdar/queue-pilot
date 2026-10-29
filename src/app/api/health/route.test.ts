import { describe, expect, it } from "vitest";
import { GET } from "./route";

describe("GET /api/health", () => {
  it("answers ok and is never cached", async () => {
    const res = GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, version: expect.stringMatching(/^\d+\.\d+\.\d+/) });
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
