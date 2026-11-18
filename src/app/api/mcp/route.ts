/**
 * Authenticated connector tools for the person's voice, material and Buffer drafts.
 * Reads use the saved queue. Writes recheck it and never schedule posts.
 */
import { registerControls } from "@/lib/mcp-controls";
import { registerContentItemTools } from "@/lib/mcp-content-items";
import { registerAdminTools } from "@/lib/mcp-admin-tools";
import { registerSocialAccountTools } from "@/lib/mcp-social-accounts";
import { registerReplyAutomationTools } from "@/lib/mcp-reply-automations";
import { appHasGrant } from "@/lib/admin-operations";
import { userIsAdmin } from "@/lib/admin-role";
import { requireMcpAuth } from "@better-auth/mcp";
import { REGISTRATION_ID } from "@/lib/agent-signup/tokens";
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { getAuth, mcpResource } from "@/lib/auth";
import { SERVER_INSTRUCTIONS } from "@/lib/connector-instructions";
import { approvalState, connectedApp, recordAppUse, revokeApp, UNUSED_DAYS } from "@/lib/ai-access";
import type { ConnectedApp } from "@/lib/app-identity";
import { type Actor } from "@/lib/security-events";
import { clientIp } from "@/lib/client-ip";
import { limit, limitHeaders, type Action, type Limited } from "@/lib/rate-limit";
import { createResourceServerChallenge } from "@better-auth/oauth-provider";
import { APIError } from "better-auth/api";
import pkg from "../../../../package.json";
import { guardServer } from "@/lib/mcp-guard";
import { Auth, McpContext, bufferFor } from "./tool-kit";
import { registerWeekReads, registerDraftWrites, registerDraftMoves } from "./week-tools";
import { registerNoteReads, registerNoteChanges } from "./note-tools";
import { registerIdeas, registerTagReads, registerTagWrites } from "./idea-tag-tools";
import { registerTemplates, registerSnippets, registerWorkspace } from "./workspace-tools";
import { registerMaterialIntake, registerMaterialReads } from "./material-tools";
import { registerVoice, registerSourceChecks } from "./voice-tools";

function buildServer(auth: Auth, userId: string, websiteUrl: string, clientId = "unknown", isAdmin = false) {
  // Sent once when the AI connects; clients put it in the model's context, so the AI knows the order before any tool call.
  const server = new McpServer({
    name: "queue-pilot", version: pkg.version, title: "Queue Pilot",
    websiteUrl,
    icons: [{ src: `${websiteUrl}/icon-512.png`, mimeType: "image/png", sizes: ["512x512"] }],
  }, {
    instructions: SERVER_INSTRUCTIONS,
    // The tool and prompt lists never change while the server runs. Saying so tells a 2026 client not to open a listen
    // for changes; left out, registering a tool or prompt declares listChanged true.
    capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
  });
  // Every tool, here and in src/lib, is registered through registerGuardedTool, which refuses a server without its guard.
  guardServer(server, { userId, websiteUrl });
  // The connected app's name, looked up once: Security activity names it for deletes and approvals, and the approval
  // and rule records say which app approved a draft or added a rule.
  let appLookup: Promise<ConnectedApp> | null = null;
  const app = () => (appLookup ??= connectedApp(clientId).catch(() => ({ name: "An AI app", verified: false })));
  const byApp = async (): Promise<Actor> => { const a = await app(); return { via: "ai", app: a.name, verified: a.verified }; };
  registerControls(server, userId, async (force = false) => {
    const b = await bufferFor(auth, userId, { force });
    return { ...b, userId, token: b.accessToken };
  }, websiteUrl, app);
  registerContentItemTools(server, userId, async (force = false) => {
    const b = await bufferFor(auth, userId, { force });
    return { token: b.accessToken, organizationIds: b.organizationIds, channels: b.channels, posts: b.posts };
  }, byApp);
  // The admin's tools, only for the admin. Each call still goes through the admin door, which reads the role again
  // and refuses an app the admin has not given admin access (src/lib/admin-operations.ts).
  registerSocialAccountTools(server, userId);
  registerReplyAutomationTools(server, userId);
  if (isAdmin) registerAdminTools(server, { via: "mcp", userId, clientId, site: websiteUrl });
  const c: McpContext = { server, auth, userId, websiteUrl, clientId, app, byApp };
  registerWeekReads(c);
  registerDraftWrites(c);
  registerDraftMoves(c);
  registerNoteReads(c);
  registerNoteChanges(c);
  registerIdeas(c);
  registerTagReads(c);
  registerTagWrites(c);
  registerTemplates(c);
  registerSnippets(c);
  registerWorkspace(c);
  registerMaterialIntake(c);
  registerMaterialReads(c);
  registerVoice(c);
  registerSourceChecks(c);
  return server;
}

/**
 * The answer for a token whose approval was revoked: the same RFC 9728 challenge an unauthenticated call gets (built
 * like @better-auth/mcp's own toChallengeResponse), so the AI app knows to send the person through sign-in again.
 */
function revokedChallenge(resource: string, message = "Access to Queue Pilot was revoked. Connect it again to continue."): Response {
  const challenge = createResourceServerChallenge(new APIError("UNAUTHORIZED", { message }), resource);
  const headers = new Headers(challenge?.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: challenge?.message ?? "Unauthorized" }, id: null }), { status: 401, headers });
}

/** A JSON-RPC answer for a refused request, with Retry-After and the RateLimit fields. */
function tooMany(action: Action, l: Limited): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: `Too many requests. Try again in ${l.resetSeconds} seconds.` }, id: null }), {
    status: 429,
    headers: { "Content-Type": "application/json", ...limitHeaders(action, l) },
  });
}

async function handle(req: Request): Promise<Response> {
  const auth = await getAuth();
  if (!auth) return Response.json({ error: "Queue Pilot is not open yet" }, { status: 503 });
  const websiteUrl = (await auth.$context).baseURL.replace(/\/api\/auth\/?$/, "");
  const resource = mcpResource(websiteUrl);
  const protectedHandler = requireMcpAuth(
    auth,
    async (request, claims) => {
      // A token that names no user must never act as a shared "" user.
      const userId = typeof claims.sub === "string" ? claims.sub : "";
      if (!userId) return Response.json({ error: "This token does not name a user. Connect Queue Pilot again." }, { status: 401 });
      // A signed-up agent's token is refused before it is read (its audience is /v1/, not this route); this second
      // check keeps a registration id (reg_...) from ever being treated as a person, whatever the token says.
      if (REGISTRATION_ID.test(userId) || claims.purpose === "access_token" || claims.purpose === "identity_assertion") return revokedChallenge(resource, "This connector is for people's AI apps. A signed-up agent uses /v1/ (see /auth.md).");
      // The token verifies by signature alone; this makes Revoke in Settings take effect on the very next call.
      const clientId = typeof claims.azp === "string" ? claims.azp : "";
      if (!clientId) return revokedChallenge(resource);
      const approval = await approvalState(userId, clientId);
      if (approval.state === "none") return revokedChallenge(resource);
      if (approval.state === "unused") {
        // Retire the stale approval, so connecting again asks afresh instead of reusing it and being refused again.
        await revokeApp(userId, approval.consentId);
        return revokedChallenge(resource, `This connection went ${UNUSED_DAYS} days without use, so Queue Pilot turned it off. Connect it again to continue.`);
      }
      // Seen-in-use record for the Connect screen; a failed write never blocks the call.
      await recordAppUse(userId, clientId).catch((e) => console.error(JSON.stringify({ event: "qp-app-use-write-failed", message: e instanceof Error ? e.message : String(e) })));
      const l = await limit("mcp", `${userId}:${clientId}`);
      if (!l.ok) return tooMany("mcp", l);
      // Older (2025) clients are served statelessly too, so ChatGPT and Claude work whichever protocol they speak.
      // Read once per request: a person whose admin role was removed, or an app whose admin access was taken away,
      // loses the admin tools on the next call. An app without admin access never sees them at all.
      const isAdmin = await userIsAdmin(userId).then((admin) => admin && appHasGrant(userId, clientId)).catch(() => false);
      // Listens are refused at once: Queue Pilot sends no change notices, so an open listen would only sit until the
      // host's time limit and then be opened again, using server time all day.
      const res = await createMcpHandler(() => buildServer(auth, userId, websiteUrl, clientId, isAdmin), { legacy: "stateless", maxSubscriptions: 0 }).fetch(request);
      const headers = new Headers(res.headers);
      for (const [k, v] of Object.entries(limitHeaders("mcp", l))) headers.set(k, v);
      return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
    },
    { resource },
  );
  const method = await req.clone().json().then((b: { method?: string }) => b?.method ?? "?", () => "?");
  const res = await protectedHandler(req);
  // One line per call so a failing client can be traced in the host's logs. No tokens, ids or content.
  console.log(JSON.stringify({ event: "qp-mcp-call", method, status: res.status, client: req.headers.get("user-agent")?.slice(0, 60) ?? "" }));
  // Calls that fail sign-in are counted per address, so guessing tokens or flooding the challenge is bounded.
  if (res.status === 401) {
    const l = await limit("mcpUnauthenticated", clientIp(req.headers));
    if (!l.ok) return tooMany("mcpUnauthenticated", l);
  }
  return res;
}

export const POST = handle;

/**
 * A person who opens the connector address in a browser lands on the page that explains how to add it to their AI.
 * AI apps never ask for HTML; they get 405, which tells them this server does not stream over GET.
 */
export function GET(request: Request): Response {
  if ((request.headers.get("accept") ?? "").includes("text/html")) return Response.redirect(new URL("/connect", request.url), 307);
  return new Response(null, { status: 405, headers: { allow: "POST" } });
}
