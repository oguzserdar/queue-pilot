/**
 * @fileoverview The 30-second check sends nothing unless it carries the cron secret.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn(async () => ({ handled: 0, sent: 0, next: null })));
vi.mock("@/lib/direct-post-run", () => ({ runDueDirectPosts: run }));
const { GET } = await import("./route");
const call = (auth?: string) => GET(new Request("http://x/api/cron/due", auth ? { headers: { authorization: auth } } : {}));

afterEach(() => { run.mockClear(); vi.unstubAllEnvs(); });

describe("GET /api/cron/due", () => {
  it("refuses without the header, with a wrong secret, and when no secret is set", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the due posts with the right secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect((await call("Bearer s3cret-value")).status).toBe(200);
    expect(run).toHaveBeenCalledOnce();
  });
});
