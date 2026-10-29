import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

describe("scheduled echo run", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("refuses a call without the cron secret", async () => {
    vi.stubEnv("CRON_SECRET", "s".repeat(32));
    expect((await GET(new Request("https://qp.example/api/cron/echo"))).status).toBe(401);
    expect((await GET(new Request("https://qp.example/api/cron/echo", { headers: { authorization: "Bearer wrong" } }))).status).toBe(401);
  });

  it("refuses every call when no secret is configured", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(new Request("https://qp.example/api/cron/echo", { headers: { authorization: "Bearer " } }))).status).toBe(401);
  });
});
