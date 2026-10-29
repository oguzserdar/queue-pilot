/**
 * Encryption for stored keys (operator settings and users' own AI keys).
 * AES-256-GCM: authenticated, so a changed ciphertext fails to decrypt instead of returning garbage.
 * Format: "v1:" + base64url(iv | tag | ciphertext). The master key is 32 bytes, given as 64 hex characters.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

function keyBytes(masterKeyHex: string): Buffer {
  const key = Buffer.from(masterKeyHex, "hex");
  if (key.length !== 32 || !/^[0-9a-f]{64}$/i.test(masterKeyHex)) throw new Error("Master key must be 64 hex characters (32 bytes)");
  return key;
}

/** Encrypts a secret for storage. A fresh 12-byte IV per call means the same secret never encrypts the same way twice. */
export function encryptSecret(plain: string, masterKeyHex: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(masterKeyHex), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url")}`;
}

/** Decrypts a stored secret. Throws if the value was changed, was encrypted with another key, or is not in our format. */
export function decryptSecret(stored: string, masterKeyHex: string): string {
  const [version, payload] = stored.split(":");
  if (version !== VERSION || !payload) throw new Error("Unknown secret format");
  const raw = Buffer.from(payload, "base64url");
  if (raw.length < 28) throw new Error("Secret is too short");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(masterKeyHex), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}

/** Display form of a key: a known provider prefix (if any) and the last 4 characters, never the middle. */
export function maskSecret(value: string): string {
  if (value.length < 12) return "••••";
  const prefix = ["sk-ant-", "sk-proj-", "sk-", "xai-"].find((p) => value.startsWith(p)) ?? "";
  return `${prefix}••••${value.slice(-4)}`;
}
