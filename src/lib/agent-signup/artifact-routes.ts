/**
 * The agent's tools before a claim, as a small REST surface: list and save, for material and for drafts.
 *
 * Why REST and not a second MCP endpoint. The tools are four plain reads and writes plus the account status, every
 * reply has to carry the account block and every error the flat shape (envelope.ts), and the agent already speaks
 * HTTP to register and trade its token. An MCP server would wrap those same replies in JSON-RPC and add a session
 * layer for nothing. Keeping them off /api/mcp also keeps them away from the people's connector: that route only
 * accepts a person's connector token, and these routes only accept an agent's access token (http.ts).
 *
 * Each handler goes through authorizeAgent first, so the registration comes from the verified token and nowhere else.
 */
import * as z from "zod";
import { agentReply } from "./envelope";
import { agentMaterialInput, draftInput, listArtifacts, MAX_PER_KIND, saveArtifact, type ArtifactKind } from "./artifacts";
import { agentRoute, authorizeAgent, fail, jsonBody, ok } from "./http";
import { holds } from "./registrations";

const LIST_KEY = { material: "material", draft: "drafts" } as const;
const CAPABILITY = { material: "save_material", draft: "save_drafts" } as const;
const INPUT: Record<ArtifactKind, z.ZodType<{ title: string; text: string; link?: string }>> = { material: agentMaterialInput, draft: draftInput };

/** GET (list) and POST (save) handlers for one kind of artifact. */
export function agentArtifactRoutes(kind: ArtifactKind) {
  const GET = agentRoute(async (req, server) => {
    const a = await authorizeAgent(req, server, { write: false });
    if (!a.ok) return a.res;
    return ok(agentReply({ [LIST_KEY[kind]]: await listArtifacts(a.call.registration.id, kind) }, a.call.account));
  });

  const POST = agentRoute(async (req, server) => {
    const a = await authorizeAgent(req, server, { write: true });
    if (!a.ok) return a.res;
    const { registration, account } = a.call;
    if (!(await holds(registration.id, CAPABILITY[kind]))) return fail("capability_requires_claim", { account });
    const parsed = INPUT[kind].safeParse(await jsonBody(req));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return fail("invalid_request", { account, description: `${issue?.path.join(".") || "body"}: ${issue?.message ?? "not valid"}` });
    }
    const saved = await saveArtifact(registration.id, kind, parsed.data);
    if (saved === "full") return fail("invalid_request", { account, description: `This account already holds ${MAX_PER_KIND} items of this kind.` });
    return ok(agentReply({ saved }, account), 201);
  });

  return { GET, POST };
}
