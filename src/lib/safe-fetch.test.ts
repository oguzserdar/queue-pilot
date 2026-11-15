import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { BlockedAddressError, isPublicAddress, refuseRedirect, safeFetch, safeGet, safePost } from "./safe-fetch";
import { imageLinkCheck } from "./image-check";

/** True when the call was refused by the address guard itself (thrown directly or as the cause of fetch's error). */
async function blockedBy(p: Promise<unknown>): Promise<boolean> {
  try { await p; return false; } catch (e) {
    for (let x: unknown = e; x; x = (x as { cause?: unknown }).cause) if (x instanceof BlockedAddressError) return true;
    return false;
  }
}

describe("isPublicAddress", () => {
  it("refuses loopback, private, link-local, metadata and mapped forms", () => {
    for (const a of ["127.0.0.1", "10.0.0.5", "172.16.3.4", "192.168.1.1", "169.254.169.254", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:127.0.0.1", "100.64.0.1"]) {
      expect([a, isPublicAddress(a)]).toEqual([a, false]);
    }
  });
  it("allows ordinary public addresses", () => {
    for (const a of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect([a, isPublicAddress(a)]).toEqual([a, true]);
  });
});

describe("safeFetch", () => {
  it("refuses a literal loopback URL before connecting", async () => {
    await expect(safeFetch(new URL("http://127.0.0.1:9/x.png"))).rejects.toBeInstanceOf(BlockedAddressError);
    await expect(safeFetch(new URL("http://[::1]:9/x.png"))).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it("refuses a hostname that resolves to loopback (real DNS lookup, real server listening)", async () => {
    // localhost resolves to 127.0.0.1/::1; the server is up, so only the guard can stop the request.
    let hits = 0;
    const server = createServer((_req, res) => { hits++; res.writeHead(200, { "content-type": "image/png" }).end("x"); });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { port } = server.address() as AddressInfo;
    try {
      // The guard's own refusal, not a DNS or connection failure, which would also throw with zero hits.
      expect(await blockedBy(safeFetch(new URL(`http://localhost:${port}/x.png`)))).toBe(true);
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });

  it("refuses non-web schemes", async () => {
    await expect(safeFetch(new URL("file:///etc/passwd"))).rejects.toBeInstanceOf(BlockedAddressError);
  });
});

describe("imageLinkCheck with the guard", () => {
  it("explains a private link in plain words", async () => {
    const r = await imageLinkCheck("http://169.254.169.254/latest/meta-data");
    expect(r.result).toBe("fail");
    expect(r.detail).toMatch(/private network/);
  });
});

describe("safePost (a write with the person's credentials to a server they chose)", () => {
  const body = JSON.stringify({ status: "hello" });
  it("refuses plain http, so credentials never travel unencrypted", async () => {
    await expect(safePost(new URL("http://mastodon.example/api/v1/statuses"), { body })).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it("refuses a literal private or metadata address before connecting", async () => {
    for (const u of ["https://127.0.0.1/api", "https://169.254.169.254/latest", "https://[::1]/api", "https://10.0.0.5/api"]) {
      await expect(safePost(new URL(u), { body })).rejects.toBeInstanceOf(BlockedAddressError);
    }
  });

  it("refuses a hostname that resolves to loopback (real DNS lookup)", async () => {
    // The guard's own error, not any failure (a closed port, or fetch's blocked-port list, would also throw).
    expect(await blockedBy(safePost(new URL("https://localhost/api/v1/statuses"), { body }))).toBe(true);
  });

  it("treats any redirect answer as refused, so a server cannot forward the credentials elsewhere", async () => {
    for (const status of [301, 302, 303, 307, 308]) {
      const res = new Response(null, { status, headers: { location: "https://elsewhere.example/steal" } });
      await expect(refuseRedirect(res)).rejects.toBeInstanceOf(BlockedAddressError);
    }
    const ok = new Response("{}", { status: 200 });
    await expect(refuseRedirect(ok)).resolves.toBe(ok);
  });
});

describe("safeGet (a read with the person's credentials)", () => {
  it("refuses plain http and private or metadata addresses before connecting", async () => {
    await expect(safeGet(new URL("http://mastodon.example/api/v1/notifications"))).rejects.toBeInstanceOf(BlockedAddressError);
    for (const u of ["https://127.0.0.1/api", "https://169.254.169.254/latest", "https://[::1]/api"]) {
      await expect(safeGet(new URL(u))).rejects.toBeInstanceOf(BlockedAddressError);
    }
  });

  it("refuses a hostname that resolves to loopback (real DNS lookup)", async () => {
    expect(await blockedBy(safeGet(new URL("https://localhost/api/v1/notifications")))).toBe(true);
  });
});
