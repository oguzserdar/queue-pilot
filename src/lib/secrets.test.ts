import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskSecret } from "./secrets";

const KEY = "a".repeat(64);
const OTHER = "b".repeat(64);

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a secret", () => {
    expect(decryptSecret(encryptSecret("sk-ant-api03-secret", KEY), KEY)).toBe("sk-ant-api03-secret");
  });
  it("never encrypts the same value the same way twice", () => {
    expect(encryptSecret("same", KEY)).not.toBe(encryptSecret("same", KEY));
  });
  it("refuses a value encrypted with another master key", () => {
    expect(() => decryptSecret(encryptSecret("x", OTHER), KEY)).toThrow();
  });
  it("refuses a changed ciphertext instead of returning garbage", () => {
    const stored = encryptSecret("buffer-client-secret", KEY);
    const raw = Buffer.from(stored.slice(3), "base64url");
    raw[raw.length - 1] ^= 1;
    expect(() => decryptSecret(`v1:${raw.toString("base64url")}`, KEY)).toThrow();
  });
  it("rejects a master key that is not 32 bytes of hex", () => {
    expect(() => encryptSecret("x", "short")).toThrow("64 hex");
    expect(() => encryptSecret("x", "z".repeat(64))).toThrow("64 hex");
  });
});

describe("maskSecret", () => {
  it("keeps a known prefix and the last 4 characters", () => {
    expect(maskSecret("sk-ant-api03-abcdefghijklmnop")).toBe("sk-ant-••••mnop");
    expect(maskSecret("plainclientsecret1234")).toBe("••••1234");
  });
  it("shows nothing of a short value", () => {
    expect(maskSecret("short")).toBe("••••");
  });
});
