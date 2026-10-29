// Test connector for one question: can a user's own ChatGPT (or Claude, or Grok) call a Queue Pilot WRITE tool?
// Example data only, no Buffer access, no secrets. Every approval appends a line to .data/test-writes.log as proof.
// Run: node scripts/mcp-test.mjs  (listens on :4418, path /mcp). Expose with: cloudflared tunnel --url http://localhost:4418
import { createServer } from "node:http";
import { appendFileSync, mkdirSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

const DRAFTS = [
  { id: "d1", when: "Tue 27 Oct, X, 09:00", text: "CSV export is live in Tally 1.4. One click, every invoice, ready for your accountant.", source: "GitHub release v1.4" },
  { id: "d2", when: "Tue 27 Oct, LinkedIn, 12:00", text: "From January, EU freelancers need e-invoices. Here is what changes for you.", source: "ChatGPT on the web" },
  { id: "d4", when: "Thu 29 Oct, X, 09:00", text: "We cut invoice load time by 40%. The fix was boring, which is why it worked.", source: "Your blog" },
];

function buildServer() {
  const server = new McpServer({ name: "queue-pilot-test", version: "0.0.1" });
  server.registerTool(
    "show_next_week",
    {
      title: "Show next week's drafts",
      description: "Lists the example drafts Queue Pilot prepared for next week's empty Buffer slots (test data).",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => ({ content: [{ type: "text", text: DRAFTS.map((d) => `${d.id} · ${d.when} · ${d.text} (source: ${d.source})`).join("\n") }] }),
  );
  server.registerTool(
    "approve_draft",
    {
      title: "Approve a draft",
      description: "Approves one example draft by id (d1, d2 or d4). Test only: records the approval, posts nothing.",
      inputSchema: { draftId: z.enum(["d1", "d2", "d4"]) },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ draftId }) => {
      mkdirSync(".data", { recursive: true });
      appendFileSync(".data/test-writes.log", `${new Date().toISOString()} approved ${draftId}\n`);
      return { content: [{ type: "text", text: `Approved ${draftId}. (Test: recorded, nothing posted.)` }] };
    },
  );
  return server;
}

createServer(async (req, res) => {
  if (!req.url?.startsWith("/mcp")) { res.writeHead(404).end(); return; }
  const server = buildServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on("close", () => { transport.close(); server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res);
}).listen(4418, () => console.log("test connector on http://localhost:4418/mcp"));
