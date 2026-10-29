/**
 * @fileoverview Live eval of the connector loop with a real AI app: Claude Code (the `claude` CLI, on the person's own
 * Claude plan) connects to Queue Pilot's real MCP route over HTTP, the way it does after `claude mcp add`. The route,
 * its tools, the playbook check and the database tables are real (Postgres in memory with the real migrations); the
 * judge is a real model on the eval key. Stand-ins: Buffer (records what would be saved), sign-in (a fixed user,
 * since the OAuth hop is not what is tested), and the fan-out to Telegram/Discord.
 *
 * Asked to save a draft that breaks a "do not save" rule, the AI must be refused, read why, fix the draft and save it
 * again, with nothing that breaks the rule ever reaching Buffer.
 *
 * Run: pnpm eval   (key and model from .env.eval.local; needs the `claude` CLI signed in)
 */
import { execFile } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { providerOf } from "../src/lib/ai-key-store";
import { decisionModelFor, modelFor, type AiConfig } from "../src/lib/ai-model";

const KEY = process.env.QP_EVAL_KEY ?? "";
const PROVIDER = providerOf(KEY);
const CFG: AiConfig | null = PROVIDER && process.env.QP_EVAL_MODEL ? { provider: PROVIDER, key: KEY, model: process.env.QP_EVAL_MODEL } : null;
const USER = "eval-user";

const pg = new PGlite();
const testDb = drizzle(pg, { schema: { ...(await import("../src/db/schema")), ...(await import("../src/db/auth-schema")) } });
vi.mock("../src/db", () => ({ db: () => testDb, schema: {} }));

// Sign-in stand-in: every call acts for one user through one AI app.
vi.mock("@better-auth/mcp", () => ({ requireMcpAuth: (_auth: unknown, handler: (r: Request, c: object) => Promise<Response>) => (req: Request) => handler(req, { sub: USER, azp: "claude-code" }) }));
vi.mock("../src/lib/auth", () => ({ getAuth: async () => ({ $context: Promise.resolve({ baseURL: "http://127.0.0.1/api/auth" }) }), mcpResource: (base: string) => `${base}/api/mcp` }));
vi.mock("../src/lib/ai-access", () => ({ stillApproved: async () => true, recordAppUse: async () => {} }));
vi.mock("../src/lib/buffer-token", () => ({ bufferAccessToken: async () => "buffer-token" }));
vi.mock("../src/lib/echo-run", () => ({ scheduleEcho: () => {} }));
// The judge runs on the eval key, the way judgeModelFor gives it the person's own key.
vi.mock("../src/lib/judge-model", async (orig) => ({
  ...(await orig<object>()),
  judgeModelFor: async () => (CFG ? { judges: { decider: decisionModelFor(CFG), explainer: modelFor(CFG) }, cfg: CFG, source: `${CFG.provider} ${CFG.model}`, settle: async () => {}, giveBack: async () => {} } : null),
}));

// Buffer stand-in: one LinkedIn channel posting every day at 09:00 and 17:00 UTC, an empty queue, and a record of
// every draft that would have been saved.
const savedInBuffer: string[] = [];
vi.mock("../src/lib/buffer/client", async (orig) => ({
  ...(await orig<object>()),
  bufferQuery: async (_token: string, query: string, variables?: { input?: { text?: string } } & Record<string, unknown>) => {
    const op = query.match(/\b(account|channels|posts|dailyPostingLimits|createContentItem|createPost)\b/)?.[1];
    if (op === "account") return { account: { email: "eval@example.com", organizations: [{ id: "o1" }] } };
    if (op === "channels") {
      const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => ({ day, paused: false, times: ["09:00", "17:00"] }));
      return { channels: [{ id: "li", name: "Weeknight Dinners", service: "linkedin", timezone: "UTC", isDisconnected: false, isLocked: false, isQueuePaused: false, postingSchedule: days }] };
    }
    if (op === "posts") return { posts: { edges: [], pageInfo: { hasNextPage: false, endCursor: null } } };
    if (op === "dailyPostingLimits") return { dailyPostingLimits: [] };
    if (op === "createContentItem" || op === "createPost") {
      savedInBuffer.push(JSON.stringify(variables));
      return { createContentItem: { __typename: "CreateContentItemSuccess", content: { id: `c${savedInBuffer.length}`, body: { posts: [] } } } };
    }
    throw new Error(`The Buffer stand-in got an unexpected query: ${query.slice(0, 80)}`);
  },
}));

const toolCalls: { name: string; isError: boolean; text: string }[] = [];
let server: Server;
let url = "";

beforeAll(async () => {
  await migrate(testDb, { migrationsFolder: join(__dirname, "../drizzle"), migrationsTable: "__drizzle_migrations__", migrationsSchema: "public" });
  const { user } = await import("../src/db/auth-schema");
  await testDb.insert(user).values({ id: USER, name: "Mark Evans", email: "eval@example.com", emailVerified: true, createdAt: new Date(), updatedAt: new Date() });
  const { postgresRulesStore } = await import("../src/lib/rules-store");
  await postgresRulesStore().add(USER, { kind: "replace", from: "broth", to: "stock", text: 'Say "stock", never "broth".', channels: "all", level: "block" });
  const { POST } = await import("../src/app/api/mcp/route");
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString();
    const headers = new Headers();
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    const answer = await POST(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, body: req.method === "POST" ? body : undefined }));
    const out = await answer.text();
    // Record each tool call and whether the answer was a tool error, from the JSON-RPC traffic itself.
    try {
      const call = JSON.parse(body);
      if (call.method === "tools/call") {
        const data = out.trim().startsWith("{") ? JSON.parse(out) : JSON.parse(out.split("\n").find((l) => l.startsWith("data:"))!.slice(5));
        toolCalls.push({ name: call.params.name, isError: Boolean(data.result?.isError), text: data.result?.content?.[0]?.text ?? JSON.stringify(data.error) });
      }
    } catch {}
    res.writeHead(answer.status, Object.fromEntries(answer.headers));
    res.end(out);
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  url = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/mcp`;
});
afterAll(() => server?.close());

/** Runs Claude Code headless with only Queue Pilot's tools, connected over HTTP; `cwd` lets a run see project skills. */
function claudeCode(prompt: string, cwd?: string): Promise<string> {
  const config = JSON.stringify({ mcpServers: { "queue-pilot": { type: "http", url } } });
  return new Promise((ok, bad) =>
    execFile("claude", ["-p", prompt, "--mcp-config", config, "--strict-mcp-config", "--allowedTools", "mcp__queue-pilot,Skill", "--model", "sonnet", "--output-format", "text"], { maxBuffer: 1 << 24, timeout: 600_000, cwd }, (e, out, err) => (e ? bad(new Error(`${e.message}\n${err}`)) : ok(out))),
  );
}

describe.skipIf(!CFG)("a real AI app against the real connector", () => {
  it("is refused for a draft that breaks a block rule, fixes it, saves again, and Buffer never gets the broken one", async () => {
    const reply = await claudeCode(
      "Use the queue-pilot tools only. Call list_open_slots, then call save_drafts with title \"Soup\" and exactly this one draft for the first open slot: \"Chicken noodle soup in 25 minutes: simmer the noodles in a good chicken broth, add lemon at the end. What is your cold-night soup?\". If Queue Pilot refuses a draft, read why, change the draft as it asks, and call save_drafts again. Then say what happened.",
    );
    console.log("TOOL CALLS:\n" + toolCalls.map((c, i) => `${i + 1}. ${c.name}${c.isError ? " [isError]" : ""}: ${c.text.slice(0, 300)}`).join("\n"));
    console.log("SAVED IN BUFFER:\n" + savedInBuffer.join("\n"));
    console.log("CLAUDE CODE SAID:\n" + reply);
    const saves = toolCalls.filter((c) => c.name === "save_drafts");
    expect(saves[0]?.isError).toBe(true);
    expect(saves.at(-1)?.isError).toBe(false);
    expect(savedInBuffer.length).toBeGreaterThan(0);
    expect(savedInBuffer.join(" ").toLowerCase()).not.toContain("broth");
  });

  it("with the skills pack, reads voice and playbook first and saves nothing before the person says yes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "qp-skills-"));
    if (process.env.EVAL_NO_SKILLS !== "1") cpSync(join(__dirname, "../plugin/skills"), join(dir, ".claude/skills"), { recursive: true });
    const before = toolCalls.length;
    const savedBefore = savedInBuffer.length;
    const reply = await claudeCode("fill my week", dir);
    const calls = toolCalls.slice(before).map((c) => c.name);
    console.log("SKILL RUN TOOL CALLS: " + calls.join(", ") + "\nCLAUDE CODE SAID:\n" + reply);
    expect(calls).toContain("get_my_voice");
    expect(calls).toContain("get_playbook");
    if (calls.includes("list_open_slots")) expect(calls.indexOf("get_my_voice")).toBeLessThan(calls.indexOf("list_open_slots"));
    expect(calls).not.toContain("save_drafts");
    expect(savedInBuffer.length).toBe(savedBefore);
  });
});
