# Giving an AI safe write access to Buffer

How Queue Pilot lets an AI assistant change things in a person's Buffer, and the rule each change follows. It's written for the next builder who wants to put Buffer's API behind an MCP server. Copy the ideas freely (MIT); the code is linked so you can check every claim.

Last checked: 5 November 2026, against Buffer's [API reference](https://developers.buffer.com/reference.md), [changelog](https://developers.buffer.com/changelog.md) and [MCP guide](https://developers.buffer.com/guides/integrations/mcp.md).

## The idea in one paragraph

Buffer's API supports writing posts, ideas, notes and tags, subject to the connection’s permissions. Queue Pilot exposes selected operations to connected AI assistants. So Queue Pilot gives each write its own named tool with a narrow job, refuses anything outside that job on the server, and defaults to asking the person before scheduling. A person can also disable assistant scheduling or enable direct scheduling in Settings. The design draws on the three mitigations OWASP lists for AI agents that can act ([LLM06:2025 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)): as few tools as needed, as little power per tool as needed, and a person approving anything with a big effect.

## Buffer writes exposed by QP’s connector

| The AI can | Buffer operation | MCP tool | The rule, enforced on the server | Test |
|---|---|---|---|---|
| Save drafts | `createContentItem` (falls back to `createPost` per channel) | `save_drafts` | Always `saveToDraft: true`. Checked against the person's playbook, the network's character limit and Buffer's `dailyPostingLimits` first | [src/lib/save-drafts.test.ts](../src/lib/save-drafts.test.ts) |
| Edit a draft | `editPost` | `update_draft` | Only drafts this app wrote (`wroteIds`). Re-reads the post first and refuses if its text changed since the AI saw it | [src/lib/edit-drafts.test.ts](../src/lib/edit-drafts.test.ts) |
| Delete a draft | `deletePost` | `delete_draft` | Only drafts this app wrote, only while still a draft. Counts only `DeletePostSuccess` | [src/lib/edit-drafts.test.ts](../src/lib/edit-drafts.test.ts) |
| Approve (schedule) | `editPost` with `saveToDraft: false` | `approve_drafts` | Per-person setting: off, ask, or direct. In "ask", the first call changes nothing and returns a signed, single-use token bound to each draft's text, channel, time and media. The second call must return that token. The assistant is instructed to ask first; the token does not independently prove human consent | [src/app/api/mcp/route.test.ts](../src/app/api/mcp/route.test.ts) |
| Add a note | `createCollaborationNote` | `add_draft_note` | Only on drafts this app wrote, with status read directly from Buffer before adding the note. Missing Notes permission returns a reconnect message | [src/lib/buffer/notes.test.ts](../src/lib/buffer/notes.test.ts) |
| Save an idea | `createIdea` | `save_idea` | Ideas only. Posts and schedules nothing | [src/lib/buffer/ideas.test.ts](../src/lib/buffer/ideas.test.ts) |
| Create a tag | `createTag` | `create_tag` | The person's own organization only | [src/lib/buffer/tags.test.ts](../src/lib/buffer/tags.test.ts) |
| Tag a draft | `editPost` with `tagIds` | `tag_draft` | Only drafts this app wrote, only while still a draft, only the organization's own tag ids. Sends the post's current text with the tags, since Buffer refuses an edit without text | [src/lib/buffer/tags.test.ts](../src/lib/buffer/tags.test.ts), [src/app/(app)/tag-actions.test.ts](../src/app/%28app%29/tag-actions.test.ts) |
| Mention a teammate in a note | `createCollaborationNote` with mention annotations | `add_draft_note` (`mention`) | Only teammates `selectableTeamMembers` offers for that post's channel, and only where the note already names them as @Name; Buffer checks each mention again. New in v0.7, live check pending | [src/lib/buffer/notes.test.ts](../src/lib/buffer/notes.test.ts) |
| Save or replace a hashtag set | `createSnippet`, `updateSnippet` | `save_snippet` | The person's own organization. Needs `snippets:write`; an older connection gets a reconnect message. New in v0.7, live check pending | [src/lib/buffer/library.test.ts](../src/lib/buffer/library.test.ts), [src/app/api/mcp/route.test.ts](../src/app/api/mcp/route.test.ts) |
| Delete a hashtag set | `deleteSnippet` | `delete_snippet` | Asks first, since every teammate loses it. New in v0.7, live check pending | [src/app/api/mcp/route.test.ts](../src/app/api/mcp/route.test.ts) |
| Rename or delete a tag | `updateTag`, `deleteTag` | `rename_tag`, `delete_tag` | Exact name from the organization's tags; locked tags are not renamed; delete asks first. Buffer allows only organization administrators. New in v0.7, live check pending | [src/lib/buffer/tags.test.ts](../src/lib/buffer/tags.test.ts) |
| Write once before choosing accounts | `createContentItemDraft`, `updateContentItemDraft` | `save_channel_less_draft` | A client request id makes a retry return the same draft. Replacing text needs the text last read, so an edit in Buffer is refused, not overwritten. Drafts with media are left alone. New in v0.7, live check pending | [src/lib/buffer/content-items.test.ts](../src/lib/buffer/content-items.test.ts) |
| One draft per account | `promoteContentItemDraftToPosts` | `promote_to_draft_posts` | Every post `saveToDraft: true`. Each version checked against that account's limit from Buffer's `configuration` when Buffer states one (the built-in table otherwise) and its rules, with its source evidence, before anything is created. Claimed in a table first, so a recovery after an unclear answer records only posts this app asked for. New in v0.7, live check pending | [src/lib/promotion-attempts-postgres.test.ts](../src/lib/promotion-attempts-postgres.test.ts), [src/app/api/mcp/route.test.ts](../src/app/api/mcp/route.test.ts) |
| Maintain content items | `updateContentItem`, `deleteContentItem`, `addPostToContentItem`, `removePostFromContentItem` | `update_content_item`, `delete_content_item`, `link_post_to_content_item`, `unlink_post_from_content_item` | Only items in the person's own organizations; delete asks first and reports what a read-back shows after any error. New in v0.7, live check pending | [src/app/api/mcp/route.test.ts](../src/app/api/mcp/route.test.ts) |

The connector has no publish-now or arbitrary GraphQL tool. Its draft edit, delete, tag and note-write tools are restricted to drafts Queue Pilot wrote. The organization tools (tags, hashtag sets, content items) work only inside the person's own Buffer organizations, and the ones that delete something everyone shares ask first. Scheduling follows the person’s off, ask or direct setting; direct mode does not require another confirmation in chat.

## Six rules worth copying

**1. One named tool per job, no generic "run any mutation" tool.** Named tools make each action and its restrictions easier to describe and test. A generic tool can enforce permissions too; the server checks matter whichever tool design you choose. All tools: [src/app/api/mcp/route.ts](../src/app/api/mcp/route.ts).

**2. Know which drafts are yours.** Buffer's `via` field doesn't tell you which app owns a draft (drafts Queue Pilot created came back as `buffer`). Queue Pilot keeps its own record of what it wrote, per person, and every draft edit, delete, note write and tag write checks it first: `wroteIds` in [src/lib/written-store.ts](../src/lib/written-store.ts).

**3. Re-read before you write.** The AI may be acting on a copy that is minutes old. Before an edit, Queue Pilot reads the post from Buffer again and refuses if the text no longer matches what the AI saw ([src/lib/edit-drafts.ts](../src/lib/edit-drafts.ts)). Before tagging, it reads the post's status and current text ([src/lib/buffer/tags.ts](../src/lib/buffer/tags.ts)).

**4. Bind confirmation to the drafts being approved.** In "ask" mode, `approve_drafts` returns a server-signed token bound to the draft contents, channels, times and media returned to the assistant. It expires in 10 minutes, works once, and becomes invalid if the relevant draft or permission settings change. The assistant is instructed to show the drafts and ask for consent. Because the assistant receives the token, it does not independently prove that a person saw the drafts or said yes. Direct mode skips this second confirmation. See `signApproval` and `verifyApproval` in [src/lib/agent-permission.ts](../src/lib/agent-permission.ts).

**5. Keep note text separate from permission to act.** Queue Pilot tells the assistant to treat notes as source material, not authorization. The Notes operations themselves do not schedule, edit or delete posts. That does not guarantee that note text cannot influence an assistant’s later tool calls. Those calls still need their own server-side checks ([src/lib/buffer/notes.ts](../src/lib/buffer/notes.ts), [src/app/api/mcp/route.ts](../src/app/api/mcp/route.ts)).

**6. Say honestly what each tool does.** Every tool declares MCP's `readOnlyHint`, `destructiveHint` and `openWorldHint`, and every tool that writes to Buffer says `openWorldHint: true`, so a client can treat it with more care. A test keeps that true: [src/app/api/mcp/tool-definitions.test.ts](../src/app/api/mcp/tool-definitions.test.ts).

## When Buffer's own MCP server is the better fit

Buffer runs its own MCP server at `mcp.buffer.com` ([guide](https://developers.buffer.com/guides/integrations/mcp.md)). It is broader on purpose, and it is the right choice when someone needs its documented tools for threads, media, templates, metrics, publishing. Queue Pilot is narrower on purpose. As of 5 November 2026:

| | Buffer's MCP | Queue Pilot |
|---|---|---|
| Posts | Create posts; edit/delete where permitted by Buffer. `create_post` can publish immediately | Draft creation; scheduling follows off, ask or direct setting |
| Ideas | Read and save | Read and save |
| Notes | `get_post` lists notes; the guide does not establish support for the new Collaboration Notes writes | Read and add Collaboration Notes; the app UI also edits and deletes them |
| Tags | No named tool listed in the current guide | Create, rename, delete, and tag drafts |
| Templates | Yes (list, read, create, update, delete) | Read, fill from a source and check against the playbook; no template writes |
| Hashtag sets (snippets) | No named tool listed in the current guide | Read, save, replace and delete |
| Write once, several accounts | Not described in the current guide | Channel-less drafts promoted into one checked draft per account |
| Metrics | Yes | No (metrics are closed to OAuth apps) |
| Everything else | Two generic tools "reach the rest of the GraphQL API"; their names aren't published | Not reachable |
| Scope | "Covers your whole account… no per-organization scoping" | The person's own drafts; organization-scoped tags, hashtag sets and content items |

Buffer’s server exposes a broader set of operations. QP adds its saved voice, playbook and source checks, with scheduling controlled by the person’s off, ask or direct setting. Both can connect to the same Buffer account.

See also: [Building on the Buffer API: what I learned](buffer-api-notes.md) for sign-in, rate limits and draft writing.
