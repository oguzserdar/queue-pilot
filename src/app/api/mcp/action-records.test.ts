/**
 * @fileoverview Gate on the code that schedules or deletes: each path records its action for Security activity, and
 * the team-wide deletes say plainly that the whole team loses the item and that the AI must get a yes first.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(join(__dirname, "../../..", p), "utf8");
const route = src("app/api/mcp/route.ts");
const items = src("lib/mcp-content-items.ts");
const actions = src("app/(app)/actions.ts");
/** The source of one registered tool, from its name to the next registration. */
const tool = (file: string, name: string) => {
  const start = file.indexOf(`"${name}"`, file.indexOf("registerTool("));
  const end = file.indexOf("registerTool(", start);
  return file.slice(start, end === -1 ? undefined : end);
};
/** The source of one exported server action. */
const action = (name: string) => actions.slice(actions.indexOf(`export async function ${name}(`), actions.indexOf("\nexport ", actions.indexOf(`export async function ${name}(`) + 1));

describe("action records", () => {
  it.each([["delete_draft", "draft_deleted"], ["delete_draft_note", "note_deleted"], ["delete_tag", "tag_deleted"], ["delete_snippet", "snippet_deleted"], ["approve_drafts", "drafts_approved"]])("%s records %s under the connected app", (name, kind) => {
    expect(tool(route, name)).toContain(`recordAction(userId, "${kind}", await byApp()`);
  });

  it("delete_content_item records its delete under the connected app", () => {
    expect(tool(items, "delete_content_item")).toContain(`recordAction(userId, "content_item_deleted", await by()`);
  });

  it.each([["approveDrafts", "drafts_approved"], ["deleteMyDraft", "draft_deleted"]])("the app's %s button records %s as Queue Pilot", (name, kind) => {
    expect(action(name)).toContain(`recordAction(b.userId, "${kind}", { via: "app" }`);
  });

  it("delete_draft_note asks for a yes and is marked destructive", () => {
    const t = tool(route, "delete_draft_note");
    expect(t).toMatch(/get a clear yes first/);
    expect(t).toMatch(/destructiveHint: true/);
  });

  it.each([[route, "delete_tag"], [route, "delete_snippet"], [items, "delete_content_item"]])("%#: the team-wide delete says the whole team loses it and asks for a yes", (file, name) => {
    const t = tool(file, name);
    expect(t).toMatch(/whole organization/);
    expect(t).toMatch(/get a clear yes first/);
    expect(t).toMatch(/destructiveHint: true/);
  });
});
