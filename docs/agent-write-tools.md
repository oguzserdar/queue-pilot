# Giving an AI safe write access to Buffer

How Queue Pilot lets an AI assistant change things in a person's Buffer, and the rule each change follows. It's written for the next builder who wants to put Buffer's API behind an MCP server. Copy the ideas freely (MIT); the code is linked so you can check every claim.

Last checked: 4 November 2026, against Buffer's [API reference](https://developers.buffer.com/reference.md), [changelog](https://developers.buffer.com/changelog.md) and [MCP guide](https://developers.buffer.com/guides/integrations/mcp.md).

## The idea in one paragraph

Buffer's API can change almost anything in an account. An AI connected to it should be able to do the useful part of that, and nothing more. So Queue Pilot gives each write its own named tool with a narrow job, refuses anything outside that job on the server, and asks the person before anything goes out in public. It follows the three fixes OWASP lists for AI agents that can act ([LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)): as few tools as needed, as little power per tool as needed, and a person approving anything with a big effect.

## Every Buffer write, its tool and its guard

| The AI can | Buffer operation | MCP tool | The rule, enforced on the server | Test |
|---|---|---|---|---|
| Save drafts | `createContentItem` (falls back to `createPost` per channel) | `save_drafts` | Always `saveToDraft: true`. Checked against the person's playbook, the network's character limit and Buffer's `dailyPostingLimits` first | `src/lib/save-drafts.test.ts` |
| Edit a draft | `editPost` | `update_draft` | Only drafts this app wrote (`wroteIds`). Re-reads the post first and refuses if its text changed since the AI saw it | `src/lib/edit-drafts.test.ts` |
| Delete a draft | `deletePost` | `delete_draft` | Only drafts this app wrote, only while still a draft. Counts only `DeletePostSuccess` | `src/lib/edit-drafts.test.ts` |
| Approve (schedule) | `editPost` with `saveToDraft: false` | `approve_drafts` | Per-person setting: off, ask, or direct. In "ask", the first call changes nothing and returns a signed, single-use token bound to each draft's text, channel, time and media. The second call must bring that token back after the person says yes | `src/app/api/mcp/route.test.ts` |
| Add a note | `createCollaborationNote` | `add_draft_note` | Only on drafts this app wrote. Missing `notes:write` becomes "sign in with Buffer again", never a crash | `src/lib/buffer/notes.test.ts` |
| Save an idea | `createIdea` | `save_idea` | Ideas only. Posts and schedules nothing | `src/lib/buffer/ideas.test.ts` |
| Create a tag | `createTag` | `create_tag` | The person's own organization only | `src/lib/buffer/tags.test.ts` |
| Tag a draft | `editPost` with `tagIds` | `tag_draft` | Only drafts this app wrote, only while still a draft, only the organization's own tag ids. Sends the post's current text with the tags, since Buffer refuses an edit without text | `src/lib/buffer/tags.test.ts`, `src/app/(app)/tag-actions.test.ts` |

What the AI cannot do at all: publish now, schedule without the person's yes, edit or delete a post the person wrote in Buffer, touch a post that is already scheduled or sent, or run an arbitrary GraphQL query or mutation.

## Six rules worth copying

**1. One named tool per job, no generic "run any mutation" tool.** A generic tool hands the AI the whole API, including deletes. Named tools let the server check each call against a rule, and let the person read in plain words what their AI may do. All tools: `src/app/api/mcp/route.ts`.

**2. Know which drafts are yours.** Buffer's `via` field doesn't tell you which app owns a draft (drafts Queue Pilot created came back as `buffer`). Queue Pilot keeps its own record of what it wrote, per person, and every edit, delete, note and tag checks it first: `wroteIds` in `src/lib/written-store.ts`.

**3. Re-read before you write.** The AI may be acting on a copy that is minutes old. Before an edit, Queue Pilot reads the post from Buffer again and refuses if the text no longer matches what the AI saw (`src/lib/edit-drafts.ts`). Before tagging, it reads the post's status and current text (`src/lib/buffer/tags.ts`).

**4. Make "yes" impossible to fake.** An AI can claim the person agreed. In "ask" mode, `approve_drafts` returns a token signed on the server and bound to exactly the drafts that were shown. It expires in 10 minutes, works once, and stops working if a draft or the person's setting changes: `signApproval` and `verifyApproval` in `src/lib/agent-permission.ts`.

**5. Treat text other people wrote as information, never as instructions.** Since 3 November, Buffer notes carry teammates' words. An AI that reads "delete this post" in a note must not do it. Notes in Queue Pilot can't approve, schedule, edit or delete anything (`src/lib/buffer/notes.ts`).

**6. Say honestly what each tool does.** Every tool declares MCP's `readOnlyHint`, `destructiveHint` and `openWorldHint`, and every tool that writes to Buffer says `openWorldHint: true`, so a client can treat it with more care. A test keeps that true: `src/app/api/mcp/tool-definitions.test.ts`.

## When Buffer's own MCP server is the better fit

Buffer runs its own MCP server at `mcp.buffer.com` ([guide](https://developers.buffer.com/guides/integrations/mcp.md)). It is broader on purpose, and it is the right choice when someone wants their assistant to do anything they could do in Buffer: threads, media, templates, metrics, publishing. Queue Pilot is narrower on purpose. As of 4 November 2026:

| | Buffer's MCP | Queue Pilot |
|---|---|---|
| Posts | Create, edit, delete any post; `create_post` "can publish immediately" | Drafts only; scheduling needs the person's yes |
| Ideas | Read and save | Read and save |
| Notes | Read (on `get_post`) | Read and add |
| Tags | No named tool | Create and tag drafts |
| Templates, metrics | Yes | No (metrics are closed to OAuth apps) |
| Everything else | Two generic tools "reach the rest of the GraphQL API"; their names aren't published | Not reachable |
| Scope | "Covers your whole account… no per-organization scoping" | The person's own drafts, organization-scoped tags |

Use Buffer's server for full control from your assistant. Use a narrow server like Queue Pilot's when you want your assistant to prepare the week and leave the decision to you. They work side by side.

See also: [Building on the Buffer API: what I learned](buffer-api-notes.md) for sign-in, rate limits and draft writing.
