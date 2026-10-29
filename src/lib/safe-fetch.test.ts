import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import { BlockedAddressError, isPublicAddress, safeFetch } from "./safe-fetch";
import { imageLinkCheck } from "./image-check";

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
      await expect(safeFetch(new URL(`http://localhost:${port}/x.png`))).rejects.toThrow();
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
