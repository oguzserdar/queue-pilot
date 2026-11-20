/**
 * @fileoverview Buffer's GraphQL API as the MCP route tests see it: the fake's state (posts, content items, notes, tags,
 * ideas, the template and snippet library) and one small handler per Buffer operation. `fakeAnswer` picks the first
 * handler whose operation the query names, in the order below, which is the order the operations must be checked in:
 * some operation names contain others (`contentItems(` before `contentItem(input`, `createContentItemDraft(` before
 * `createContentItem`), and a few requests carry several operations at once.
 */
import { expect } from "vitest"
import type { Channel, Post } from "@/lib/buffer/queries"
import { BufferApiError } from "@/lib/buffer/client"
import { nextWeekRange } from "@/lib/week-from-buffer"
import type { Call } from "./fake-buffer"

/** A post as a save or promote request sends it to Buffer. */
type PostInput = { channelId: string; text: string; saveToDraft: boolean; needsApproval?: boolean; mode?: string; dueAt?: string }
/**
 * The `input` of a request. Buffer's inputs differ per operation, and each handler reads only its own operation's
 * fields, which that operation always sends.
 */
type Input = {
  id: string; contentItemId?: string; postId: string; noteId: string; correlationId: string; organizationId: string
  title?: string | null; targetDate?: string | null; text?: string; name?: string; saveToDraft?: boolean; tagIds?: string[]
  annotations?: unknown; draft: { text: string; aiAssisted: boolean }; posts: PostInput[]
  subject: { postId?: string; contentItemId?: string }; tag: { name: string; color: string }
  content: { title?: string; text?: string; services?: string[]; aiAssisted?: boolean }; group?: { groupId?: string }
}
/** A request's GraphQL variables: the operation's input, paging, and the aliased ids of batched reads. */
type Vars = { input: Input; team: Input; post: { id: string }; after?: string; first: number; [alias: string]: unknown }
/** A post inside a content item, as Buffer returns it. */
type ItemPost = { id: string; channelId: string; status: string; text: string; dueAt: string | null }
/** A Buffer content item as the fake keeps it: a channel-less draft, or the draft posts made from it. */
export type FakeItem = { id: string; correlationId?: string; organizationId: string; title: string | null; targetDate: string | null; createdAt: string; allowedActions: string[]; tags: unknown[]; body: { __typename: string; text?: string; aiAssisted?: boolean; assets?: unknown[]; posts?: ItemPost[] } }

/** The person's Buffer posts. Tests replace them with `setPosts`. */
export let posts: Post[] = []
/** Replaces the posts in the fake Buffer. */
export function setPosts(next: Post[]) { posts = next }
let serial = 0
/** A number never handed out before in this test file, for ids. */
export function nextSerial() { return ++serial }
export const channel: Channel = { id: "ch", name: "My channel", service: "linkedin", organizationId: "org", timezone: "UTC", isDisconnected: false, isLocked: false, isQueuePaused: false, postingSchedule: [{ day: "mon", paused: false, times: ["09:00", "12:00"] }] }
// Buffer collaboration Notes in the fake: what exists, whether the token has the Notes permission, and a dropped create.
export const notesFake = { notes: [] as { postId: string; node: Record<string, unknown> }[], allowed: true, dropCreate: false, annotations: [] as unknown[], writes: [] as { kind: "update" | "delete"; noteId: string; text?: string; annotations?: unknown }[], refuseUpdate: "" }
// Buffer tags in the fake.
export const tagsFake = { tags: [] as { id: string; name: string; color: string; isLocked: boolean }[] }
// Buffer content items in the fake, keyed by id; promote can succeed, refuse, or fail after creating the drafts.
export const itemsFake = { items: new Map<string, FakeItem>(), extraChannels: [] as Channel[], promote: "ok" as "ok" | "refuse" | "failAfter" | "throwAfter", promotes: 0, dropCreate: false, createRefusal: "", readFails: false, deleteThrows: false, reads: 0, attachOnRead: 0 }
// Buffer's template library, snippets, teammates and channel configuration in the fake.
export const libFake = { orgs: ["org"], templatePages: 1, snippetPage: 100, noLimit: false, maxLength: 3000, snippetsAllowed: true, snippetsEntitled: true, templateCount: 0, snippets: [] as { id: string; name: string; text: string }[], authorization: [{ feature: "posting", status: "ok", reason: null }] as { feature: string; status: string; reason: string | null }[] }
// The Buffer ideas board in the fake: its columns, its ideas, and a dropped create.
export const ideasFake = { groups: [{ id: "g1", name: "Next week", isLocked: false }], ideas: [] as Record<string, unknown>[], dropCreate: false }
// Notes on open posts as Buffer's posts query returns them, by post id.
export const openNotes = new Map<string, { text: string; type: string; createdAt: string | null; author: { name: string | null } | null }[]>()

type Handler = (v: Vars, query: string) => unknown
const page = <T>(nodes: T[], endCursor: string | null = null) => ({ edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage: false, endCursor } })
const account = () => ({ email: "a@example.com", timezone: "UTC", organizations: libFake.orgs.map((id) => ({ id })) })
const itemById = (id: string) => itemsFake.items.get(id)!
const madePost = (p: { channelId: string; text: string; dueAt: string }): Post => ({ id: `post-${nextSerial()}`, channelId: p.channelId, text: p.text, dueAt: p.dueAt, status: "draft", via: "api", sentAt: null, externalLink: null, error: null })

// A refresh asks for the account and each organization's channels and first page of posts in one request, one alias
// per field, as Buffer allows.
const refresh: Handler = (_v, query) => {
  const out: Record<string, unknown> = query.includes("account {") ? { account: account() } : {}
  for (const [, n] of query.matchAll(/\bc(\d+): channels\(/g)) {
    out[`c${n}`] = [channel, ...itemsFake.extraChannels]
    out[`p${n}`] = { edges: structuredClone(posts).map((node) => ({ node })), pageInfo: { hasNextPage: false, endCursor: null } }
  }
  return out
}
// Open posts with the notes people wrote on them, one alias per channel (listOpenWithNotes).
const openPostsWithNotes: Handler = (v) => Object.fromEntries(Object.entries(v as Record<string, string>).filter(([k]) => k.startsWith("ch")).map(([k, id]) => [`c${k.slice(2)}`, { edges: posts.filter((p) => p.channelId === id && p.status !== "sent").map((p) => ({ node: { id: p.id, channelId: p.channelId, text: p.text, sentAt: null, notes: openNotes.get(p.id) ?? [] } })) }]))

const readItem: Handler = (v) => {
  if (itemsFake.readFails) return new TypeError("fetch failed")
  const it = itemsFake.items.get(v.input.id)
  // Someone attaches an image in Buffer between two reads, leaving the text unchanged.
  if (it && ++itemsFake.reads === itemsFake.attachOnRead) it.body.assets = [{ type: "image" }]
  if (!it) return new BufferApiError("Content item not found", 200)
  return { contentItem: structuredClone(it) }
}
const createItemDraft: Handler = (v) => {
  if (itemsFake.createRefusal) return new BufferApiError(itemsFake.createRefusal, 200)
  const existing = [...itemsFake.items.values()].find((i) => i.correlationId === v.input.correlationId)
  if (existing) return { createContentItemDraft: { __typename: "CreateContentItemDraftSuccess", contentItem: structuredClone(existing) } }
  const it: FakeItem = { id: `ci-${itemsFake.items.size + 1}`, correlationId: v.input.correlationId, organizationId: v.input.organizationId, title: v.input.title ?? null, targetDate: v.input.targetDate ?? null, createdAt: "2026-11-05T00:00:00Z", allowedActions: ["updateContentItem", "deleteContentItem"], tags: [], body: { __typename: "DraftContent", text: v.input.draft.text, aiAssisted: v.input.draft.aiAssisted, assets: [] } }
  itemsFake.items.set(it.id, it)
  if (itemsFake.dropCreate) { itemsFake.dropCreate = false; return new TypeError("fetch failed") }
  return { createContentItemDraft: { __typename: "CreateContentItemDraftSuccess", contentItem: structuredClone(it) } }
}
const updateItemDraft: Handler = (v) => {
  const it = itemById(v.input.id)
  it.body = { __typename: "DraftContent", text: v.input.draft.text, aiAssisted: true, assets: [] }
  return { updateContentItemDraft: { __typename: "UpdateContentItemDraftSuccess", contentItem: structuredClone(it) } }
}
const promoteItem: Handler = (v) => {
  itemsFake.promotes++
  const it = itemById(v.input.id)
  if (itemsFake.promote === "refuse") return { promoteContentItemDraftToPosts: { __typename: "PromoteContentItemDraftToPostsFailure", message: "Invalid", errors: [{ __typename: "PostInvalidInputError", message: "Bad", channelId: "ch" }] } }
  // Like Buffer: a queued draft gets the next free time (here Wednesday next week, 15:00 UTC); a custom time is kept.
  const queued = new Date(nextWeekRange(new Date(), "UTC").start.getTime() + (2 * 24 + 15) * 3600_000).toISOString()
  const made = v.input.posts.map((p) => {
    expect(p).toMatchObject({ saveToDraft: true, needsApproval: false })
    return madePost({ channelId: p.channelId, text: p.text, dueAt: p.dueAt ?? queued })
  })
  posts.push(...made)
  it.body = { __typename: "PostContent", posts: made.map((m) => ({ id: m.id, channelId: m.channelId, status: "draft", text: m.text!, dueAt: m.dueAt })) }
  if (itemsFake.promote === "failAfter") return { promoteContentItemDraftToPosts: { __typename: "PromoteContentItemDraftToPostsFailure", message: "Post processing failed", errors: [] } }
  if (itemsFake.promote === "throwAfter") return new TypeError("fetch failed")
  return { promoteContentItemDraftToPosts: { __typename: "PromoteContentItemDraftToPostsSuccess", contentItem: structuredClone(it) } }
}
const updateItem: Handler = (v) => {
  const it = itemById(v.input.id)
  if ("title" in v.input) it.title = v.input.title as string | null
  return { updateContentItem: { __typename: "UpdateContentItemSuccess", contentItem: structuredClone(it) } }
}
// Like Buffer: the post joins or leaves the item, which comes back as it now is.
const linkPost: Handler = (v, query) => {
  const it = itemById(v.input.contentItemId ?? v.input.id)
  const adding = query.includes("addPostToContentItem(")
  const list = it.body.posts ?? []
  const known = list.find((p) => p.id === v.input.postId) ?? posts.find((p) => p.id === v.input.postId)
  let next = list.filter((p) => p.id !== v.input.postId)
  if (adding) next = list.some((p) => p.id === v.input.postId) ? list : [...list, { id: known!.id, channelId: known!.channelId, status: "draft", text: known!.text!, dueAt: known!.dueAt ?? null }]
  it.body = { __typename: "PostContent", posts: next }
  const key = adding ? "addPostToContentItem" : "removePostFromContentItem"
  return { [key]: { __typename: adding ? "AddPostToContentItemSuccess" : "RemovePostFromContentItemSuccess", contentItem: structuredClone(it) } }
}
// Like Buffer: deleting an item deletes the posts made from it.
const deleteItem: Handler = (v) => {
  const gone = itemsFake.items.get(v.input.id)?.body?.posts?.map((p) => p.id) ?? []
  posts = posts.filter((p) => !gone.includes(p.id))
  itemsFake.items.delete(v.input.id)
  if (itemsFake.deleteThrows) { itemsFake.readFails = true; return new TypeError("fetch failed") }
  return { deleteContentItem: { __typename: "EmptySuccess", _empty: "" } }
}
const createItem: Handler = (v) => {
  const added = v.input.posts.map((p) => {
    expect(p.saveToDraft).toBe(true)
    return madePost({ channelId: channel.id, text: p.text, dueAt: p.dueAt! })
  })
  posts.push(...added)
  return { createContentItem: { __typename: "CreateContentItemSuccess", content: { body: { posts: added } } } }
}

const editPost: Handler = (v) => {
  expect(v.input.saveToDraft).toBe(true)
  // saveToDraft on a scheduled post takes it off the schedule, as Buffer's EditPostInput describes.
  posts = posts.map((p) => p.id === v.input.id ? { ...p, ...(p.status === "scheduled" ? { status: "draft" } : {}), ...(v.input.text !== undefined ? { text: v.input.text } : {}), ...(v.input.tagIds ? { tagIds: v.input.tagIds } : {}) } : p)
  return { editPost: { __typename: "PostActionSuccess" } }
}
const teamMembers = () => ({ selectableTeamMembers: { edges: [{ node: { id: "acc-1", name: "Sara", email: "sara@example.com", avatar: "", isLocked: false, urn: "urn:buffer:account:acc-1" } }], pageInfo: { hasNextPage: false, endCursor: null } } })
// A post read with its channel's teammates in one request (two top-level fields).
const postWithTeam: Handler = (v) => ({ post: structuredClone(posts.find((p) => p.id === v.post.id)) ?? null, team: teamMembers().selectableTeamMembers })
const postsById: Handler = (v) => Object.fromEntries(Object.entries(v as Record<string, { id: string }>).map(([k, ref]) => [`p${k.slice(1)}`, structuredClone(posts.find((p) => p.id === ref.id)) ?? null]))

/** Answers a Notes operation only when the token has Buffer's Notes permission. */
const withNotes = (handler: Handler): Handler => (v, query) => (notesFake.allowed ? handler(v, query) : new BufferApiError("Forbidden", 200, "INSUFFICIENT_SCOPE"))
const noteKey = (v: Vars) => v.input.subject.postId ?? `item:${v.input.subject.contentItemId}`
const updateNote: Handler = (v) => {
  notesFake.writes.push({ kind: "update", noteId: v.input.noteId, text: v.input.text, annotations: v.input.annotations })
  if (notesFake.refuseUpdate) return { updateCollaborationNote: { __typename: notesFake.refuseUpdate, message: "Mentioned account cannot access this post" } }
  const n = notesFake.notes.find((x) => x.node.id === v.input.noteId)
  if (n) n.node = { ...n.node, text: v.input.text, updatedAt: "2026-11-05T09:00:00Z" }
  return { updateCollaborationNote: { __typename: "UpdateCollaborationNoteSuccess" } }
}
const deleteNote: Handler = (v) => {
  notesFake.writes.push({ kind: "delete", noteId: v.input.noteId })
  notesFake.notes = notesFake.notes.filter((x) => x.node.id !== v.input.noteId)
  return { deleteCollaborationNote: { __typename: "DeleteCollaborationNoteSuccess" } }
}
const createNote: Handler = (v) => {
  if (notesFake.dropCreate) return new TypeError("fetch failed")
  notesFake.annotations.push(v.input.annotations)
  const node = { id: `note-${notesFake.notes.length + 1}`, text: v.input.text, authorId: "me", author: { id: "me", name: "Me" }, allowedActions: ["updateNote", "deleteNote"], createdAt: "2026-11-04T09:00:00Z", updatedAt: "2026-11-04T09:00:00Z" }
  // A channel-less draft's own thread is keyed "item:<id>" here.
  notesFake.notes.push({ postId: noteKey(v), node })
  return { createCollaborationNote: { __typename: "CreateCollaborationNoteSuccess", edge: { node } } }
}
const listNotes: Handler = (v) => ({ collaborationNotes: page(notesFake.notes.filter((n) => n.postId === noteKey(v)).map((n) => n.node)) })

const updateTag: Handler = (v) => {
  const t = tagsFake.tags.find((x) => x.id === v.input.id)
  if (!t) return { updateTag: { __typename: "InvalidInputError", message: "No such tag" } }
  if (tagsFake.tags.some((x) => x.name === v.input.tag.name && x.id !== t.id)) return { updateTag: { __typename: "DuplicateError", message: "Duplicate" } }
  Object.assign(t, v.input.tag)
  return { updateTag: { __typename: "TagActionSuccess", tag: t } }
}
const createTag: Handler = (v) => {
  const { name, color } = v.input.tag
  if (tagsFake.tags.some((t) => t.name === name)) return { createTag: { __typename: "DuplicateError", message: "Duplicate" } }
  const tag = { id: `tag-${tagsFake.tags.length + 1}`, name, color, isLocked: false }
  tagsFake.tags.push(tag)
  return { createTag: { __typename: "TagActionSuccess", tag } }
}
const createIdea: Handler = (v) => {
  if (ideasFake.dropCreate) return new TypeError("fetch failed")
  const { organizationId, content, group } = v.input
  const node = { id: `idea-${ideasFake.ideas.length + 1}`, organizationId, groupId: group?.groupId ?? null, createdAt: 1_762_160_400, content: { title: content.title ?? null, text: content.text ?? null, services: content.services ?? [], date: null }, aiAssisted: content.aiAssisted }
  ideasFake.ideas.push(node)
  return { createIdea: { __typename: "Idea", id: node.id } }
}

const offset = (after: string | undefined, prefix: number) => (after ? Number(String(after).slice(prefix)) : 0)
// Like Buffer's library: N templates paged by `first`, with long placeholder labels; one late template is about holidays.
const templateLibrary: Handler = (v) => {
  const from = offset(v.after, 1)
  const to = Math.min(from + v.first, libFake.templateCount)
  const nodes = Array.from({ length: to - from }, (_, k) => { const n = from + k; return { id: `tpl-${n}`, title: n === 150 ? "Holiday hours" : `Release note ${n}`, description: n === 150 ? "Tell people when you are closed" : "Share what shipped this week and why it matters to the people who use it", emoji: "🚀", body: "I read {{the piece: an article, a post, a podcast episode, with the author's name}}. {{why it matters: what it changes for the people you make things for}}", visibility: "public", organizationId: v.input.organizationId, updatedAt: "2026-11-01T00:00:00Z" } })
  return { postTemplates: { edges: nodes.map((node) => ({ node })), pageInfo: { hasNextPage: to < libFake.templateCount, endCursor: `o${to}` } } }
}
const templatePages: Handler = (v) => {
  const i = offset(v.after, 1)
  const last = i + 1 >= libFake.templatePages
  return { postTemplates: { edges: [{ node: { id: `tpl-${i}`, title: `Release ${i}`, description: "A release note", emoji: "🚀", body: "Shipped {{feature}}. {{link}}", visibility: "public", organizationId: v.input.organizationId, updatedAt: "2026-11-01T00:00:00Z" } }], pageInfo: { hasNextPage: !last, endCursor: last ? null : `c${i + 1}` } } }
}
const template: Handler = (v) => ({ postTemplate: v.input.id === "tpl-0" ? { id: "tpl-0", title: "Release 0", description: "A release note", emoji: "🚀", body: "Shipped {{feature}}. {{link}}", visibility: "public", organizationId: "org", updatedAt: "2026-11-01T00:00:00Z" } : null })

/** Answers a snippet operation only when the token may read snippets and the organization's plan includes them. */
const withSnippets = (handler: Handler): Handler => (v, query) => {
  if (!libFake.snippetsAllowed) return new BufferApiError("Forbidden", 200, "INSUFFICIENT_SCOPE")
  if (!libFake.snippetsEntitled) return new BufferApiError("Organization does not have required entitlements", 200)
  return handler(v, query)
}
const createSnippet: Handler = (v) => { const sn = { id: `sn-${libFake.snippets.length + 1}`, name: v.input.name!, text: v.input.text! }; libFake.snippets.push(sn); return { createSnippet: { __typename: "CreateSnippetSuccess", snippet: sn } } }
const updateSnippet: Handler = (v) => {
  const sn = libFake.snippets.find((x) => x.id === v.input.id)
  if (!sn) return { updateSnippet: { __typename: "VoidMutationError", message: "Snippet not found" } }
  Object.assign(sn, { name: v.input.name, text: v.input.text })
  return { updateSnippet: { __typename: "UpdateSnippetSuccess", snippet: sn } }
}
const deleteSnippet: Handler = (v) => { libFake.snippets = libFake.snippets.filter((x) => x.id !== v.input.id); return { deleteSnippet: { __typename: "DeleteSnippetSuccess", id: v.input.id } } }
// Pages of libFake.snippetPage items, so a snippet can sit on a later page.
const listSnippets: Handler = (v) => {
  const start = offset(v.after, 2)
  const end = Math.min(start + libFake.snippetPage, libFake.snippets.length)
  return { snippets: { edges: libFake.snippets.slice(start, end).map((node) => ({ node })), pageInfo: { hasNextPage: end < libFake.snippets.length, endCursor: end < libFake.snippets.length ? `sc${end}` : null } } }
}
const configuration: Handler = () => ({ configuration: { channels: [{ channelId: channel.id, service: "linkedin", channelType: "profile", authorizationStatus: libFake.authorization, content: [{ configurationContentTypes: ["post"], rules: libFake.noLimit ? [] : [{ __typename: "LengthRule", property: "text", maxLength: libFake.maxLength }] }] }] } })

const has = (...ops: string[]) => (query: string) => ops.some((op) => query.includes(op))
const all = (...ops: string[]) => (query: string) => ops.every((op) => query.includes(op))
const isNotes = has("collaborationNotes(", "CollaborationNote(")
const isSnippets = has("snippets(", "Snippet(")
const both = (a: (q: string) => boolean, b: (q: string) => boolean) => (query: string) => a(query) && b(query)

/** Buffer's operations in the order they are matched, each with its handler. */
const routes: [matches: (query: string) => boolean, handler: Handler][] = [
  [(q) => /\bc\d+: channels\(/.test(q), refresh],
  [has("{ account"), () => ({ account: account() })],
  [has("channels(input"), () => ({ channels: [channel, ...itemsFake.extraChannels] })],
  [has("needs_approval, scheduled"), openPostsWithNotes],
  [has("posts(input"), () => ({ posts: { edges: structuredClone(posts).map((node) => ({ node })), pageInfo: { hasNextPage: false } } })],
  // Content items: checked before the createContentItem save path, whose name is a prefix.
  [has("contentItems("), () => ({ contentItems: page([...itemsFake.items.values()].map((node) => structuredClone(node))) })],
  [has("contentItem(input"), readItem],
  [has("createContentItemDraft("), createItemDraft],
  [has("updateContentItemDraft("), updateItemDraft],
  [has("promoteContentItemDraftToPosts("), promoteItem],
  [has("updateContentItem("), updateItem],
  [has("addPostToContentItem(", "removePostFromContentItem("), linkPost],
  [has("deleteContentItem("), deleteItem],
  [has("createContentItem"), createItem],
  [all("post(input", "team: selectableTeamMembers("), postWithTeam],
  [has("p0: post(input"), postsById],
  [has("post(input"), (v) => ({ post: structuredClone(posts.find((p) => p.id === v.input.id)) })],
  [has("editPost"), editPost],
  [has("deletePost"), (v) => { posts = posts.filter((p) => p.id !== v.input.id); return { deletePost: { __typename: "DeletePostSuccess" } } }],
  [both(isNotes, has("updateCollaborationNote")), withNotes(updateNote)],
  [both(isNotes, has("deleteCollaborationNote")), withNotes(deleteNote)],
  [both(isNotes, has("createCollaborationNote")), withNotes(createNote)],
  [isNotes, withNotes(listNotes)],
  [has("tagsV2("), () => ({ tagsV2: page(tagsFake.tags) })],
  [has("updateTag("), updateTag],
  [has("deleteTag("), (v) => { tagsFake.tags = tagsFake.tags.filter((x) => x.id !== v.input.id); return { deleteTag: { __typename: "DeleteTagActionSuccess", id: v.input.id } } }],
  [has("createTag("), createTag],
  [has("ideaGroups("), () => ({ ideaGroups: ideasFake.groups })],
  [has("ideas(input"), () => ({ ideas: page(ideasFake.ideas) })],
  [has("createIdea("), createIdea],
  [(q) => q.includes("postTemplates(") && libFake.templateCount > 0, templateLibrary],
  [has("postTemplates("), templatePages],
  [has("postTemplate("), template],
  [both(isSnippets, has("createSnippet(")), withSnippets(createSnippet)],
  [both(isSnippets, has("updateSnippet(")), withSnippets(updateSnippet)],
  [both(isSnippets, has("deleteSnippet(")), withSnippets(deleteSnippet)],
  [isSnippets, withSnippets(listSnippets)],
  [has("selectableTeamMembers("), teamMembers],
  [has("configuration("), configuration],
]

/** Answers one request the way Buffer would, from the first operation the query names. */
export function fakeAnswer(call: Call): unknown {
  const route = routes.find(([matches]) => matches(call.query))
  if (!route) throw new Error("Unexpected Buffer query")
  return route[1](call.variables as unknown as Vars, call.query)
}
