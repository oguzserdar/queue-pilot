/**
 * The models a person's key can use, read from the provider each time instead of a list in our code.
 * Anthropic (GET /v1/models) states each model's lifecycle, line and structured-output support, so the default is
 * picked from those facts. OpenAI (GET /v1/models) states only id, date and owner, so text models are told apart by
 * name and the default is the newest small one; the person can pick any other from the list. OpenRouter
 * (GET /api/v1/models/user, the key's own list) states each model's supported parameters, so only models that can
 * return structured output are offered, and Claude Sonnet is the default when the key can use it.
 */
import type { Provider } from "./ai-key-store";

export type ModelOption = { id: string; name: string };
export type ModelList = { models: ModelOption[]; recommended: string | null };

/** Anthropic API version sent on every call; its models list carries lifecycle, line and capabilities. */
export const ANTHROPIC_VERSION = "2026-10-21";
const TIMEOUT_MS = 15_000;

export class ModelListError extends Error {}

type AnthropicModel = { id: string; display_name?: string; created_at?: string; lifecycle?: string; line?: string | null; capabilities?: { structured_outputs?: { supported?: boolean } } | null };
type OpenAiModel = { id: string; created?: number };
type OpenRouterModel = { id: string; name?: string; supported_parameters?: string[] };

/** From Anthropic's list (newest first): active models only; default is the newest Sonnet with structured outputs. */
export function fromAnthropic(data: AnthropicModel[]): ModelList {
  const active = data.filter((m) => (m.lifecycle ?? "active") === "active");
  const json = (m: AnthropicModel) => m.capabilities?.structured_outputs?.supported !== false;
  const pick = active.find((m) => m.line === "sonnet" && json(m)) ?? active.find(json) ?? active[0];
  return { models: active.map((m) => ({ id: m.id, name: m.display_name ?? m.id })), recommended: pick?.id ?? null };
}

/** OpenAI's list names no capabilities: keep GPT text models by name, newest first; default is the newest small one. */
export function fromOpenAi(data: OpenAiModel[]): ModelList {
  const text = data
    .filter((m) => /^gpt-/.test(m.id) && !/(audio|realtime|transcribe|tts|image|search|embedding|instruct|preview)/.test(m.id))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  const pick = text.find((m) => /(mini|nano|luna)/.test(m.id)) ?? text[0];
  return { models: text.map((m) => ({ id: m.id, name: m.id })), recommended: pick?.id ?? null };
}

/** From OpenRouter's list: models that can return structured output; default is Claude Sonnet, else the first. */
export function fromOpenRouter(data: OpenRouterModel[]): ModelList {
  const usable = data.filter((m) => m.supported_parameters?.includes("structured_outputs"));
  const pick = usable.find((m) => /^anthropic\/claude-sonnet/.test(m.id)) ?? usable[0];
  return { models: usable.map((m) => ({ id: m.id, name: m.name ?? m.id })), recommended: pick?.id ?? null };
}

const OPENROUTER = "https://openrouter.ai";
const OPENROUTER_MAX_PAGES = 5;

async function listOpenRouter(key: string, fetchImpl: typeof fetch): Promise<ModelList> {
  const all: OpenRouterModel[] = [];
  let url: string | null = `${OPENROUTER}/api/v1/models/user`;
  for (let page = 0; url && page < OPENROUTER_MAX_PAGES; page++) {
    const res: Response = await fetchImpl(url, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(TIMEOUT_MS) }).catch(() => {
      throw new ModelListError("Could not reach OpenRouter to check the key. Try again.");
    });
    if (res.status === 401 || res.status === 403) throw new ModelListError("OpenRouter refused this key.");
    if (!res.ok) throw new ModelListError(`OpenRouter did not list its models (${res.status}). Try again.`);
    const body = (await res.json().catch(() => null)) as { data?: unknown; links?: { next?: string | null } } | null;
    if (!body || !Array.isArray(body.data)) throw new ModelListError("OpenRouter answered in a shape Queue Pilot does not know.");
    all.push(...(body.data as OpenRouterModel[]));
    url = body.links?.next ? new URL(body.links.next, OPENROUTER).toString() : null;
  }
  const list = fromOpenRouter(all);
  if (!list.models.length) throw new ModelListError("This OpenRouter key cannot use any model that returns structured output.");
  return list;
}

/** Lists the models this key can use. Also the key check: a refused key throws before it is saved. */
export async function listModels(provider: Provider, key: string, fetchImpl: typeof fetch = fetch): Promise<ModelList> {
  if (provider === "openrouter") return listOpenRouter(key, fetchImpl);
  const anthropic = provider === "anthropic";
  const name = anthropic ? "Anthropic" : "OpenAI";
  const res = await fetchImpl(anthropic ? "https://api.anthropic.com/v1/models?limit=100" : "https://api.openai.com/v1/models", {
    headers: anthropic ? { "x-api-key": key, "anthropic-version": ANTHROPIC_VERSION } : { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  }).catch(() => {
    throw new ModelListError(`Could not reach ${name} to check the key. Try again.`);
  });
  if (res.status === 401 || res.status === 403) throw new ModelListError(`${name} refused this key.`);
  if (!res.ok) throw new ModelListError(`${name} did not list its models (${res.status}). Try again.`);
  const body = (await res.json().catch(() => null)) as { data?: unknown } | null;
  if (!body || !Array.isArray(body.data)) throw new ModelListError(`${name} answered in a shape Queue Pilot does not know.`);
  const list = anthropic ? fromAnthropic(body.data as AnthropicModel[]) : fromOpenAi(body.data as OpenAiModel[]);
  if (!list.models.length) throw new ModelListError(`This ${name} key cannot use any text model.`);
  return list;
}
