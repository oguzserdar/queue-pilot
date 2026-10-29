import { describe, expect, it, vi } from "vitest";
import { channelCheck } from "./preflight";
import { imageLinkCheck } from "./image-check";

const ok = { name: "X", isDisconnected: false, isLocked: false, isQueuePaused: false };

describe("channelCheck", () => {
  it("passes a connected channel with a running queue", () => {
    expect(channelCheck(ok).result).toBe("pass");
  });
  it("fails disconnected, locked and paused channels with a reason", () => {
    expect(channelCheck({ ...ok, isDisconnected: true }).detail).toContain("disconnected");
    expect(channelCheck({ ...ok, isLocked: true }).detail).toContain("locked");
    expect(channelCheck({ ...ok, isQueuePaused: true }).detail).toContain("paused");
  });
});

const res = (status: number, type: string) => new Response(status === 200 || status === 206 ? "x" : null, { status, headers: { "content-type": type } });

describe("imageLinkCheck", () => {
  it("passes a reachable image and asks for one byte only", async () => {
    const fetchImpl = vi.fn(async () => res(206, "image/png"));
    expect((await imageLinkCheck("https://cdn.example/a.png", { fetchImpl })).result).toBe("pass");
    const [, init] = fetchImpl.mock.calls[0] as unknown as [URL, RequestInit];
    expect((init.headers as Record<string, string>).Range).toBe("bytes=0-0");
  });
  it("fails a share page that returns HTML instead of the image", async () => {
    const r = await imageLinkCheck("https://drive.example/view?id=1", { fetchImpl: vi.fn(async () => res(200, "text/html; charset=utf-8")) });
    expect(r.result).toBe("fail");
    expect(r.detail).toContain("text/html");
  });
  it("fails a missing image", async () => {
    expect((await imageLinkCheck("https://cdn.example/gone.png", { fetchImpl: vi.fn(async () => res(404, "text/plain")) })).result).toBe("fail");
  });
  it("fails a link that does not answer", async () => {
    const r = await imageLinkCheck("https://slow.example/a.png", { fetchImpl: vi.fn(async () => { throw new Error("timeout"); }) });
    expect(r.detail).toContain("did not answer");
  });
  it("fails malformed and non-web links without fetching", async () => {
    const fetchImpl = vi.fn();
    expect((await imageLinkCheck("not a url", { fetchImpl })).result).toBe("fail");
    expect((await imageLinkCheck("file:///etc/passwd", { fetchImpl })).result).toBe("fail");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("image check verdicts that decide Approve", () => {
  it("warns, not fails, when the host turns away automated checks", async () => {
    for (const status of [401, 403, 429]) {
      const r = await imageLinkCheck("https://cdn.example/a.png", { fetchImpl: async () => res(status, "text/html") });
      expect(r.result).toBe("warn");
    }
  });
  it("still fails a missing image", async () => {
    expect((await imageLinkCheck("https://cdn.example/a.png", { fetchImpl: async () => res(404, "text/html") })).result).toBe("fail");
  });
  it("warns when the link does not answer in time", async () => {
    const r = await imageLinkCheck("https://cdn.example/a.png", { fetchImpl: async () => { throw new DOMException("timed out", "TimeoutError"); } });
    expect(r.result).toBe("warn");
  });
});
