/**
 * @fileoverview The reply run answers nothing unless the call carries the cron secret.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const run = vi.hoisted(() => vi.fn<typeof import("@/lib/reply-run").runDueReplies>(async () => ({ accounts: 0, primed: 0, recorded: 0, sent: 0, held: 0, failed: 0, uncertain: 0, skipped: 0 })));
vi.mock("@/lib/reply-run", () => ({ runDueReplies: run }));
const { GET } = await import("./route");
const call = (auth?: string) => GET(new Request("http://x/api/cron/replies", auth ? { headers: { authorization: auth } } : {}));

afterEach(() => { run.mockClear(); vi.unstubAllEnvs(); });

describe("GET /api/cron/replies", () => {
  it("refuses without the header, with a wrong secret, and when no secret is set", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect((await call()).status).toBe(401);
    expect((await call("Bearer wrong")).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("runs the replies with the right secret", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret-value");
    expect((await call("Bearer s3cret-value")).status).toBe(200);
    expect(run).toHaveBeenCalledOnce();
  });
});
