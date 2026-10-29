/**
 * A person's own AI key for drafting in the web app. Stored encrypted under SETTINGS_KEY (src/lib/secrets.ts); the
 * plain key leaves this module only for the call to the provider, and screens see only the masked form.
 */
import { eq } from "drizzle-orm";
import { db } from "../db";
import { aiKey } from "../db/schema";
import { decryptSecret, encryptSecret, maskSecret } from "./secrets";

export const PROVIDERS = { anthropic: "Anthropic (Claude)", openai: "OpenAI (ChatGPT)", openrouter: "OpenRouter (any model)" } as const;
export type Provider = keyof typeof PROVIDERS;

/** The provider a pasted key belongs to, from its published prefix; null when it matches neither. */
export function providerOf(key: string): Provider | null {
  const k = key.trim();
  // OpenRouter first: its keys also start with "sk-", so the OpenAI pattern would match them.
  if (/^sk-or-v1-[0-9a-f]{64}$/.test(k)) return "openrouter";
  if (/^sk-ant-[\w-]{20,}$/.test(k)) return "anthropic";
  if (/^sk-(proj-)?[\w-]{20,}$/.test(k)) return "openai";
  return null;
}

export type AiKeyStore = {
  get(userId: string): Promise<{ provider: Provider; key: string; model: string | null } | null>;
  /** Masked form for screens, e.g. "sk-ant-••••abcd". */
  shown(userId: string): Promise<{ provider: Provider; masked: string; model: string | null } | null>;
  set(userId: string, provider: Provider, key: string, model: string): Promise<void>;
  /** Changes the model only; the key stays as it is. */
  setModel(userId: string, model: string): Promise<void>;
  remove(userId: string): Promise<void>;
};

export function postgresAiKeyStore(masterKeyHex: string): AiKeyStore {
  const read = async (userId: string) => {
    const [row] = await db().select().from(aiKey).where(eq(aiKey.userId, userId));
    return row ? { provider: row.provider as Provider, key: decryptSecret(row.keyEnc, masterKeyHex), model: row.model } : null;
  };
  return {
    get: read,
    async shown(userId) {
      const k = await read(userId);
      return k ? { provider: k.provider, masked: maskSecret(k.key), model: k.model } : null;
    },
    async set(userId, provider, key, model) {
      const keyEnc = encryptSecret(key.trim(), masterKeyHex);
      await db().insert(aiKey).values({ userId, provider, keyEnc, model }).onConflictDoUpdate({ target: aiKey.userId, set: { provider, keyEnc, model, updatedAt: new Date() } });
    },
    async setModel(userId, model) {
      await db().update(aiKey).set({ model, updatedAt: new Date() }).where(eq(aiKey.userId, userId));
    },
    async remove(userId) {
      await db().delete(aiKey).where(eq(aiKey.userId, userId));
    },
  };
}
