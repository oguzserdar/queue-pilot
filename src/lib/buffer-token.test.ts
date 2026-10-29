import { describe, expect, it, vi } from "vitest";
import { bufferAccessToken, type WithLock } from "./buffer-token";

vi.mock("./db", () => ({ dbLockPool: () => { throw new Error("no database in tests"); } }));
vi.mock("./auth", () => ({ BUFFER_PROVIDER_ID: "buffer" }));

/** A fake Better Auth whose getAccessToken counts calls, standing in for the refresh that spends Buffer's single-use token. */
function fakeAuth(delayMs = 5) {
  const getAccessToken = vi.fn(async () => {
    await new Promise((r) => setTimeout(r, delayMs));
    return { accessToken: "fresh" };
  });
  const auth = {
    $context: Promise.resolve({ internalAdapter: { findAccounts: async () => [{ id: "acc1", providerId: "buffer" }] } }),
    api: { getAccessToken },
  };
  return { auth: auth as never, getAccessToken };
}

const recordingLock = () => {
  const keys: string[] = [];
  const lock: WithLock = async (key, fn) => { keys.push(key); return fn(); };
  return { lock, keys };
};

describe("bufferAccessToken", () => {
  it("lets only one call per user reach Better Auth at a time (no double refresh of a single-use token)", async () => {
    const { auth, getAccessToken } = fakeAuth();
    const { lock } = recordingLock();
    const tokens = await Promise.all([1, 2, 3].map(() => bufferAccessToken(auth, "u1", lock)));
    expect(tokens).toEqual(["fresh", "fresh", "fresh"]);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
  });

  it("takes the cross-instance lock named for the user", async () => {
    const { auth } = fakeAuth();
    const { lock, keys } = recordingLock();
    await bufferAccessToken(auth, "u2", lock);
    expect(keys).toEqual(["buffer-token:u2"]);
  });

  it("does not share across users", async () => {
    const { auth, getAccessToken } = fakeAuth();
    const { lock } = recordingLock();
    await Promise.all([bufferAccessToken(auth, "a", lock), bufferAccessToken(auth, "b", lock)]);
    expect(getAccessToken).toHaveBeenCalledTimes(2);
  });

  it("fails plainly when the account has no Buffer connection, and the next call can retry", async () => {
    const auth = { $context: Promise.resolve({ internalAdapter: { findAccounts: async () => [] } }), api: { getAccessToken: vi.fn() } } as never;
    const { lock } = recordingLock();
    await expect(bufferAccessToken(auth, "u3", lock)).rejects.toThrow("no Buffer connection");
    await expect(bufferAccessToken(auth, "u3", lock)).rejects.toThrow("no Buffer connection");
  });
});
