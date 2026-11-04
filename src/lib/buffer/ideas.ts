/**
 * @fileoverview The person's Buffer ideas board: read ideas with their columns, and add an idea (Buffer reference,
 * read 3 Nov 2026). Ideas need ideas:read / ideas:write, which Queue Pilot has asked for since its first release.
 *
 * Buffer gives no duplicate protection on createIdea, so a create that fails on the network is never retried here:
 * Buffer may already have saved it. Every idea Queue Pilot adds is marked aiAssisted, because an AI wrote it.
 */
import { bufferQuery } from "./client";

/** One idea as Queue Pilot shows it. */
export type BufferIdea = {
  id: string;
  organizationId: string;
  title: string | null;
  text: string | null;
  /** The column it sits in, or null for ideas outside any column. */
  group: string | null;
  /** The networks the person tagged it for (Buffer's service names). */
  services: string[];
  /** A target date the person set, if any. */
  date: string | null;
  createdAt: string;
};

/** One column on the ideas board. */
export type IdeaGroup = { id: string; name: string; isLocked: boolean };

/** Buffer's network names an idea can be tagged with. */
export const IDEA_SERVICES = ["bluesky", "facebook", "googlebusiness", "instagram", "linkedin", "mastodon", "pinterest", "startPage", "substack", "threads", "tiktok", "twitter", "whatsapp", "youtube"] as const;
/** Limits Queue Pilot applies; Buffer documents none. */
export const MAX_IDEA_TITLE = 200;
export const MAX_IDEA_TEXT = 10_000;

type Run = typeof bufferQuery;
type RawIdea = { id: string; organizationId: string; groupId: string | null; createdAt: number; content: { title: string | null; text: string | null; services: string[]; date: string | null } };

/**
 * The columns on one organization's ideas board.
 *
 * @param token - The person's Buffer access token
 * @param organizationId - The Buffer organization
 * @returns Its idea groups
 */
export async function listIdeaGroups(token: string, organizationId: string, run: Run = bufferQuery): Promise<IdeaGroup[]> {
  const data = await run<{ ideaGroups: IdeaGroup[] }>(token, "query IdeaGroups($input: IdeaGroupsInput!) { ideaGroups(input: $input) { id name isLocked } }", { input: { organizationId } });
  return data.ideaGroups;
}

/**
 * The ideas on one organization's board, newest pages first as Buffer returns them, up to `max`.
 *
 * @param token - The person's Buffer access token
 * @param organizationId - The Buffer organization
 * @param max - Most ideas to return
 * @returns The ideas with their column names, and whether more exist beyond `max`
 */
export async function listIdeas(token: string, organizationId: string, max = 50, run: Run = bufferQuery): Promise<{ ideas: BufferIdea[]; more: boolean }> {
  const groups = new Map((await listIdeaGroups(token, organizationId, run)).map((g) => [g.id, g.name]));
  const ideas: BufferIdea[] = [];
  let after: string | null = null;
  for (;;) {
    const first: number = Math.min(100, max - ideas.length);
    const data: { ideas: { edges: { node: RawIdea }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } = await run(token,
      "query Ideas($input: IdeasInput!, $first: Int, $after: String) { ideas(input: $input, first: $first, after: $after) { edges { node { id organizationId groupId createdAt content { title text services date } } } pageInfo { hasNextPage endCursor } } }",
      { input: { organizationId }, first, after });
    for (const { node } of data.ideas.edges) {
      ideas.push({ id: node.id, organizationId: node.organizationId, title: node.content.title ?? null, text: node.content.text ?? null, group: node.groupId ? groups.get(node.groupId) ?? null : null, services: node.content.services ?? [], date: node.content.date ?? null, createdAt: new Date(node.createdAt * 1000).toISOString() });
    }
    const { hasNextPage, endCursor } = data.ideas.pageInfo;
    if (!hasNextPage || !endCursor) return { ideas, more: false };
    if (ideas.length >= max) return { ideas, more: true };
    after = endCursor;
  }
}

/** A create's outcome: the new idea's id, or Buffer's typed refusal. */
export type CreateIdeaResult = { ok: true; id: string } | { ok: false; kind: "limit" | "invalid" | "unauthorized" | "other"; message: string };

/**
 * Adds an idea to the board. Never retried on a network failure, since Buffer may already have saved it.
 *
 * @param token - The person's Buffer access token
 * @param organizationId - The Buffer organization that will own it
 * @param idea - Title and/or text, the networks it is for, and an optional column
 * @returns The new idea's id, or Buffer's refusal
 */
export async function createIdea(token: string, organizationId: string, idea: { title?: string; text?: string; services?: string[]; groupId?: string }, run: Run = bufferQuery): Promise<CreateIdeaResult> {
  const content = { aiAssisted: true, ...(idea.title ? { title: idea.title } : {}), ...(idea.text ? { text: idea.text } : {}), ...(idea.services?.length ? { services: idea.services } : {}) };
  const data = await run<{ createIdea: { __typename: string; id?: string; idea?: { id: string } | null; message?: string } }>(token,
    "mutation CreateIdea($input: CreateIdeaInput!) { createIdea(input: $input) { __typename ... on Idea { id } ... on IdeaResponse { idea { id } } ... on MutationError { message } } }",
    { input: { organizationId, content, ...(idea.groupId ? { group: { groupId: idea.groupId } } : {}) } });
  const r = data.createIdea;
  const id = r.__typename === "Idea" ? r.id : r.__typename === "IdeaResponse" ? r.idea?.id : undefined;
  if (id) return { ok: true, id };
  const kind = r.__typename === "LimitReachedError" ? "limit" : r.__typename === "InvalidInputError" ? "invalid" : r.__typename === "UnauthorizedError" ? "unauthorized" : "other";
  return { ok: false, kind, message: r.message ?? "Buffer did not save the idea." };
}
