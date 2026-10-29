/**
 * Queue Pilot connector endpoint (MCP over streamable HTTP, stateless).
 * Today it serves TEST tools with example data, to answer one question before the build window:
 * can a user's own ChatGPT, Claude or Grok call a Queue Pilot write tool on their own plan?
 * No Buffer access and no secrets here. Each approval is logged as "qp-test-write" so the test can be proven in the logs.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

const DRAFTS = [
  { id: "d1", when: "Tue 27 Oct, X, 09:00", text: "CSV export is live in Pennyrow 1.4. One click, every invoice, ready for your accountant.", source: "GitHub release v1.4" },
  { id: "d2", when: "Tue 27 Oct, LinkedIn, 12:00", text: "From January, EU freelancers need e-invoices. Here is what changes for you.", source: "ChatGPT on the web" },
  { id: "d4", when: "Thu 29 Oct, X, 09:00", text: "We cut invoice load time by 40%. The fix was boring, which is why it worked.", source: "Your blog" },
];

function buildServer() {
  const server = new McpServer({ name: "queue-pilot", version: "0.0.1" });
  server.registerTool(
    "show_next_week",
    {
      title: "Show next week's drafts",
      description: "Lists the drafts Queue Pilot prepared for next week's empty Buffer slots. Test data for now.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => ({ content: [{ type: "text", text: DRAFTS.map((d) => `${d.id} · ${d.when} · ${d.text} (source: ${d.source})`).join("\n") }] }),
  );
  server.registerTool(
    "approve_draft",
    {
      title: "Approve a draft",
      description: "Approves one draft by id (d1, d2 or d4). Test only: records the approval, posts nothing.",
      inputSchema: { draftId: z.enum(["d1", "d2", "d4"]) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ draftId }) => {
      console.log(JSON.stringify({ event: "qp-test-write", draftId, at: new Date().toISOString() }));
      return { content: [{ type: "text", text: `Approved ${draftId}. (Test: recorded, nothing posted.)` }] };
    },
  );
  return server;
}

async function handle(req: Request): Promise<Response> {
  // A local test surface only: in production it does not exist, so nobody can call it or write its log lines.
  if (process.env.NODE_ENV === "production") return new Response(null, { status: 404 });
  const server = buildServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  await server.connect(transport);
  return transport.handleRequest(req);
}

export const POST = handle;
export const GET = handle;
export const DELETE = handle;
