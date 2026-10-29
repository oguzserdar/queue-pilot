import { describe, expect, it, vi } from "vitest";
import { fromAnthropic, fromOpenAi, fromOpenRouter, listModels, ModelListError } from "./ai-models";

describe("fromAnthropic", () => {
  it("drops deprecated models and recommends the newest active Sonnet with structured outputs", () => {
    const list = fromAnthropic([
      { id: "claude-opus-new", line: "opus", lifecycle: "active", capabilities: { structured_outputs: { supported: true } } },
      { id: "claude-sonnet-new", display_name: "Claude Sonnet New", line: "sonnet", lifecycle: "active", capabilities: { structured_outputs: { supported: true } } },
      { id: "claude-sonnet-old", line: "sonnet", lifecycle: "deprecated" },
    ]);
    expect(list.models.map((m) => m.id)).toEqual(["claude-opus-new", "claude-sonnet-new"]);
    expect(list.recommended).toBe("claude-sonnet-new");
  });
  it("falls back to the newest active model when no Sonnet is listed", () => {
    expect(fromAnthropic([{ id: "a", line: "opus", lifecycle: "active" }]).recommended).toBe("a");
  });
});

describe("fromOpenAi", () => {
  it("keeps GPT text models newest first and recommends the newest small one", () => {
    const list = fromOpenAi([
      { id: "gpt-old-mini", created: 1 },
      { id: "gpt-new-luna", created: 5 },
      { id: "gpt-new-astra", created: 6 },
      { id: "gpt-new-realtime", created: 7 },
      { id: "text-embedding-x", created: 8 },
      { id: "dall-e-9", created: 9 },
    ]);
    expect(list.models.map((m) => m.id)).toEqual(["gpt-new-astra", "gpt-new-luna", "gpt-old-mini"]);
    expect(list.recommended).toBe("gpt-new-luna");
  });
});

describe("listModels", () => {
  const reply = (status: number, body: unknown) => vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  it("asks Anthropic with the key header and reads the list", async () => {
    const f = reply(200, { data: [{ id: "claude-sonnet-new", line: "sonnet", lifecycle: "active" }] });
    expect((await listModels("anthropic", "sk-ant-k", f)).recommended).toBe("claude-sonnet-new");
    expect(f.mock.calls[0][1].headers["x-api-key"]).toBe("sk-ant-k");
  });
  it("turns a refused key into a plain message", async () => {
    await expect(listModels("openai", "sk-bad", reply(401, {}))).rejects.toThrow(new ModelListError("OpenAI refused this key."));
  });
  it("refuses a key that can use no text model", async () => {
    await expect(listModels("openai", "sk", reply(200, { data: [{ id: "whisper-1" }] }))).rejects.toThrow("cannot use any text model");
  });
});

describe("fromOpenRouter", () => {
  it("keeps models that can return structured output and recommends Claude Sonnet when the key can use it", () => {
    const list = fromOpenRouter([
      { id: "openai/gpt-x", name: "OpenAI: GPT X", supported_parameters: ["structured_outputs", "tools"] },
      { id: "some/old-model", name: "Old", supported_parameters: ["temperature"] },
      { id: "anthropic/claude-sonnet-9", name: "Anthropic: Claude Sonnet 9", supported_parameters: ["structured_outputs"] },
    ]);
    expect(list.models.map((m) => m.id)).toEqual(["openai/gpt-x", "anthropic/claude-sonnet-9"]);
    expect(list.recommended).toBe("anthropic/claude-sonnet-9");
  });
  it("falls back to the first usable model", () => {
    expect(fromOpenRouter([{ id: "x/y", supported_parameters: ["structured_outputs"] }]).recommended).toBe("x/y");
  });
});

describe("listModels for OpenRouter", () => {
  it("reads the key's own model list with the key as a bearer token, following pages", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(Response.json({ data: [{ id: "a/b", supported_parameters: ["structured_outputs"] }], links: { next: "/api/v1/models/user?offset=1" } }))
      .mockResolvedValueOnce(Response.json({ data: [{ id: "c/d", supported_parameters: ["structured_outputs"] }] }));
    const list = await listModels("openrouter", "sk-or-v1-key", fetchImpl as unknown as typeof fetch);
    expect(list.models.map((m) => m.id)).toEqual(["a/b", "c/d"]);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/models/user");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer sk-or-v1-key");
    expect(fetchImpl.mock.calls[1][0]).toBe("https://openrouter.ai/api/v1/models/user?offset=1");
  });
  it("says OpenRouter refused the key on 401", async () => {
    const fetchImpl = vi.fn(async () => new Response("{}", { status: 401 }));
    await expect(listModels("openrouter", "bad", fetchImpl as unknown as typeof fetch)).rejects.toThrow("OpenRouter refused this key.");
  });
});

