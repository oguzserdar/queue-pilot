/**
 * @fileoverview Buffer snippets (API reference, read 5 Nov 2026; marked Experimental). Buffer defines a snippet as "a
 * named set of hashtags that a team member saves once and inserts into posts": a name and the hashtag text. Snippets
 * belong to the organization. Reading needs snippets:read, writing snippets:write. A Buffer connection made before
 * Queue Pilot asked for those permissions surfaces as SnippetsNotAllowedError, so the person can connect again; nothing
 * else stops working.
 *
 * Why Queue Pilot uses them: the writer can add the person's own saved hashtag set instead of inventing hashtags, and an
 * assistant can keep the sets tidy (create, rename, replace, delete) for the person. Both show how a second interface
 * or an AI can maintain this part of a Buffer account through the API.
 */
import { BufferApiError, bufferQuery } from "./client";
import { pageOf, readPages, type Paged } from "./paging";

/** One snippet: a named hashtag set. */
export type BufferSnippet = { id: string; name: string; text: string };

type Run = typeof bufferQuery;
type Connection<T> = { edges: { node: T }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };

/** Buffer rejects pages over 100. */
const PAGE = 100;
const MAX_PAGES = 3;

/** The Buffer connection was made before Queue Pilot asked for snippet access. */
export class SnippetsNotAllowedError extends Error {
  constructor() {
    super("This Buffer connection cannot read or change snippets yet. Sign in with Buffer again to allow it; everything else keeps working.");
    this.name = "SnippetsNotAllowedError";
  }
}

/**
 * Buffer itself has not enabled saved hashtag sets for the organization ("Organization does not have required
 * entitlements"). Signing in again does not change that, so this is kept apart from SnippetsNotAllowedError.
 */
export class SnippetsNotEnabledError extends Error {
  constructor() {
    super(SNIPPETS_NOT_ENABLED);
    this.name = "SnippetsNotEnabledError";
  }
}

/** What to say when Buffer has not enabled saved hashtag sets for the organization. Names no plan; Buffer did not. */
export const SNIPPETS_NOT_ENABLED = "Buffer has not enabled saved hashtag sets for this account, so Queue Pilot cannot read or save them. Everything else keeps working.";

const NOT_ENTITLED = /required entitlements?|not entitled/i;

/** Runs one snippets request, telling a missing permission apart from a feature Buffer has not enabled. */
async function guarded<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof BufferApiError && (e.code === "INSUFFICIENT_SCOPE" || /insufficient.?scope|snippets:(read|write)/i.test(e.message))) throw new SnippetsNotAllowedError();
    if (e instanceof BufferApiError && NOT_ENTITLED.test(e.message)) throw new SnippetsNotEnabledError();
    throw e;
  }
}

/**
 * The organization's snippets, sorted by name as Buffer returns them, up to a page budget.
 *
 * @param token - The person's Buffer access token
 * @param organizationId - The organization
 * @param after - A cursor from an earlier read, to continue
 * @returns The snippets read, whether more exist, and the cursor to continue
 * @throws SnippetsNotAllowedError when the token lacks snippets:read
 */
export async function listSnippets(token: string, organizationId: string, after: string | null = null, run: Run = bufferQuery): Promise<Paged<BufferSnippet>> {
  return readPages((cursor) => guarded(async () => {
    const data = await run<{ snippets: Connection<BufferSnippet> }>(token,
      "query Snippets($input: SnippetsInput!, $first: Int, $after: String) { snippets(input: $input, first: $first, after: $after) { edges { node { id name text } } pageInfo { hasNextPage endCursor } } }",
      { input: { organizationId }, first: PAGE, after: cursor });
    return pageOf(data.snippets);
  }), MAX_PAGES, after);
}

/** A snippet write's outcome, with Buffer's reason when it refused (an empty or too long name or text). */
export type SnippetWriteResult<T> = { ok: true; value: T } | { ok: false; message: string };

type Payload<K extends string, V> = { [key in K]: { __typename: string; message?: string } & V };

const refused = (message?: string): SnippetWriteResult<never> => ({ ok: false, message: message && NOT_ENTITLED.test(message) ? SNIPPETS_NOT_ENABLED : message ?? "Buffer did not save the snippet." });

/**
 * Saves a new hashtag set in the organization. Everyone in the organization can insert it into posts.
 *
 * @param token - The person's Buffer access token
 * @param organizationId - The organization that will own it
 * @param name - Its display name
 * @param text - The hashtags, as they will be inserted into a post
 * @returns The snippet as Buffer saved it, or Buffer's refusal
 * @throws SnippetsNotAllowedError when the token lacks snippets:write
 */
export async function createSnippet(token: string, organizationId: string, name: string, text: string, run: Run = bufferQuery): Promise<SnippetWriteResult<BufferSnippet>> {
  const data = await guarded(() => run<Payload<"createSnippet", { snippet?: BufferSnippet }>>(token,
    "mutation CreateSnippet($input: CreateSnippetInput!) { createSnippet(input: $input) { __typename ... on CreateSnippetSuccess { snippet { id name text } } ... on MutationError { message } } }",
    { input: { organizationId, name, text } }));
  const r = data.createSnippet;
  return r.__typename === "CreateSnippetSuccess" && r.snippet ? { ok: true, value: r.snippet } : refused(r.message);
}

/**
 * Replaces a snippet's name and text. Buffer replaces both, so pass the current value of whichever is not changing.
 *
 * @param token - The person's Buffer access token
 * @param organizationId - The organization that owns it
 * @param id - The snippet
 * @param name - The new (or unchanged) name
 * @param text - The new (or unchanged) hashtags
 * @returns The snippet after the change, or Buffer's refusal
 * @throws SnippetsNotAllowedError when the token lacks snippets:write
 */
export async function updateSnippet(token: string, organizationId: string, id: string, name: string, text: string, run: Run = bufferQuery): Promise<SnippetWriteResult<BufferSnippet>> {
  const data = await guarded(() => run<Payload<"updateSnippet", { snippet?: BufferSnippet }>>(token,
    "mutation UpdateSnippet($input: UpdateSnippetInput!) { updateSnippet(input: $input) { __typename ... on UpdateSnippetSuccess { snippet { id name text } } ... on MutationError { message } } }",
    { input: { organizationId, id, name, text } }));
  const r = data.updateSnippet;
  return r.__typename === "UpdateSnippetSuccess" && r.snippet ? { ok: true, value: r.snippet } : refused(r.message);
}

/**
 * Deletes a snippet for the whole organization: every teammate loses it, so an assistant asks first.
 *
 * @param token - The person's Buffer access token
 * @param organizationId - The organization that owns it
 * @param id - The snippet
 * @returns The deleted id, or Buffer's refusal
 * @throws SnippetsNotAllowedError when the token lacks snippets:write
 */
export async function deleteSnippet(token: string, organizationId: string, id: string, run: Run = bufferQuery): Promise<SnippetWriteResult<string>> {
  const data = await guarded(() => run<Payload<"deleteSnippet", { id?: string }>>(token,
    "mutation DeleteSnippet($input: DeleteSnippetInput!) { deleteSnippet(input: $input) { __typename ... on DeleteSnippetSuccess { id } ... on MutationError { message } } }",
    { input: { organizationId, id } }));
  const r = data.deleteSnippet;
  return r.__typename === "DeleteSnippetSuccess" && r.id ? { ok: true, value: r.id } : refused(r.message);
}
