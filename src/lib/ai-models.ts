/**
 * The models a person's key can use, read from the provider each time instead of a list in our code.
 * Anthropic (GET /v1/models) states each model's lifecycle, line and structured-output support, so the default is
 * picked from those facts. OpenAI (GET /v1/models) states only id, date and owner, so text models are told apart by
 * name and the default is the newest small one; the person can pick any other from the list. OpenRouter
 * (GET /api/v1/models/user, the key's own list) states each model's supported parameters, so only models that can
 * return structured output are offered, and Claude Sonnet is the default when the key can use it.
 */
import * as z from "zod";
import type { Provider } from "./ai-key-store";

export type ModelOption = { id: string; name: string };
export type ModelList = { models: ModelOption[]; recommended: string | null };

/** Anthropic API version sent on every call; its models list carries lifecycle, line and capabilities. */
export const ANTHROPIC_VERSION = "2026-10-21";
const TIMEOUT_MS = 15_000;

export class ModelListError extends Error {}

// Each list entry is read, not trusted: an entry without a string id is left out, and an odd optional field reads as
// missing, which the pickers below already handle.
const AnthropicModelShape = z.object({
  id: z.string(),
  display_name: z.string().optional().catch(undefined),
  created_at: z.string().optional().catch(undefined),
  lifecycle: z.string().optional().catch(undefined),
  line: z.string().nullable().optional().catch(undefined),
  capabilities: z.object({
    structured_outputs: z.object({ supported: z.boolean().optional().catch(undefined) }).optional().catch(undefined),
  }).nullable().optional().catch(undefined),
});
const OpenAiModelShape = z.object({ id: z.string(), created: z.number().optional().catch(undefined) });
const OpenRouterModelShape = z.object({
  id: z.string(),
  name: z.string().optional().catch(undefined),
  supported_parameters: z.array(z.unknown()).transform((a) => a.filter((p) => typeof p === "string")).optional().catch(undefined),
});
const ListAnswer = z.object({ data: z.array(z.unknown()) });
const OpenRouterNext = z.object({ links: z.object({ next: z.string().nullable().optional().catch(undefined) }).optional().catch(undefined) }).catch({});

type AnthropicModel = z.infer<typeof AnthropicModelShape>;
type OpenAiModel = z.infer<typeof OpenAiModelShape>;
type OpenRouterModel = z.infer<typeof OpenRouterModelShape>;

/** The entries of a list that hold the given shape. */
function entries<T>(shape: z.ZodType<T>, data: unknown[]): T[] {
  return data.flatMap((m) => {
    const parsed = shape.safeParse(m);
    return parsed.success ? [parsed.data] : [];
  });
}

/** The answer's JSON, or null when it is not JSON. */
const readJson = (res: Response): Promise<unknown> => res.json().catch(() => null);

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
    .filter((m) => m.id.startsWith("gpt-") && !/(audio|realtime|transcribe|tts|image|search|embedding|instruct|preview)/.test(m.id))
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0));
  const pick = text.find((m) => /(mini|nano|luna)/.test(m.id)) ?? text[0];
  return { models: text.map((m) => ({ id: m.id, name: m.id })), recommended: pick?.id ?? null };
}

/** From OpenRouter's list: models that can return structured output; default is Claude Sonnet, else the first. */
export function fromOpenRouter(data: OpenRouterModel[]): ModelList {
  const usable = data.filter((m) => m.supported_parameters?.includes("structured_outputs"));
  const pick = usable.find((m) => m.id.startsWith("anthropic/claude-sonnet")) ?? usable[0];
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
    const json = await readJson(res);
    const body = ListAnswer.safeParse(json);
    if (!body.success) throw new ModelListError("OpenRouter answered in a shape Queue Pilot does not know.");
    all.push(...entries(OpenRouterModelShape, body.data.data));
    const next = OpenRouterNext.parse(json).links?.next;
    url = next ? new URL(next, OPENROUTER).toString() : null;
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
  const body = ListAnswer.safeParse(await readJson(res));
  if (!body.success) throw new ModelListError(`${name} answered in a shape Queue Pilot does not know.`);
  const list = anthropic ? fromAnthropic(entries(AnthropicModelShape, body.data.data)) : fromOpenAi(entries(OpenAiModelShape, body.data.data));
  if (!list.models.length) throw new ModelListError(`This ${name} key cannot use any text model.`);
  return list;
}
