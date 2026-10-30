/**
 * The Queue Pilot agent skill: the guidance an AI app loads before it works with a person's Buffer queue. Every
 * deployment serves its own copy under /.well-known/agent-skills/ (Agent Skills discovery, v0.2) with its own
 * connector address in it, since each deployment has a different address.
 */
import { createHash } from "node:crypto";
import { FILL_WEEK_STEPS } from "./fill-week-prompt";

export const SKILL_NAME = "queue-pilot";
export const SKILL_DESCRIPTION =
  "Fill a Buffer posting week with drafts through Queue Pilot: read the person's voice, playbook and new material, write one post per empty slot, and save them in Buffer as drafts for the person to approve. Use when someone asks to fill their week, draft social posts for Buffer, or work with their Buffer queue.";

/** The connector tools and what each is for, in the order the loop uses them. */
const TOOLS: [string, string][] = [
  ["get_my_voice", "How the person writes: their note and example posts. Match it."],
  ["save_my_voice_note", "Save how the person says they write when they ask you to remember it. Up to 500 characters."],
  ["add_voice_example", "Save a post the person wrote when they ask you to learn their style. Up to 2000 characters and eight examples."],
  ["remove_voice_example", "Remove a saved style example only when the person asks, using its exact ID from get_my_voice. Does not delete the original post."],
  ["get_playbook", "Their rules per network, learned from fixes they made more than once. Follow every one."],
  ["list_new_material", "What they published recently (newsletter, blog, YouTube, releases) that no post covers yet."],
  ["read_material", "The full text of one item from list_new_material."],
  ["list_open_slots", "The empty times in their Buffer queue for the next two weeks, each with its network's character limit."],
  ["save_drafts", "Saves posts in Buffer as drafts. Each draft is checked against the playbook first; one that breaks a rule comes back with the fix."],
  ["update_draft", "Changes a draft that is already saved."],
  ["delete_draft", "Removes a draft."],
  ["show_next_week", "Monday to Sunday of their queue, slot by slot."],
  ["show_last_week_delivery", "Which posts went out last week, with Buffer's reason for any that did not."],
  ["add_source", "Adds a feed address as material."],
  ["add_material", "Keep research text with a title and optional link. Read it with read_material before drafting."],
];

/**
 * The SKILL.md text for one deployment.
 *
 * @param origin - The deployment's address, such as https://queue-pilot.example.com
 * @returns Markdown with Agent Skills front matter
 */
export function skillMarkdown(origin: string): string {
  // The description holds ": ", so it is quoted (a JSON string is a valid YAML string).
  return `---
name: ${SKILL_NAME}
description: ${JSON.stringify(SKILL_DESCRIPTION)}
---

# Queue Pilot

Queue Pilot connects your AI to a person's Buffer queue. You do the writing; Queue Pilot gives you their empty slots, their voice, their playbook and their material, and checks every draft before it lands in Buffer.

## Connect

Add this remote MCP server (Streamable HTTP) and sign in with Buffer when asked:

${origin}/api/mcp

The connector only saves drafts. Queue Pilot never schedules or publishes on its own. Only your Approve schedules. The person can also schedule drafts directly in Buffer.

## Fill the week

${FILL_WEEK_STEPS.map((s, i) => `${i + 1}. ${s}`).join("\n")}

## Tools

${TOOLS.map(([name, use]) => `- \`${name}\`: ${use}`).join("\n")}

## Rules that always hold

- Write only from the person's material. Never invent numbers, quotes, customers or features.
- Show the drafts before saving them, and save only what the person agreed to.
- When save_drafts refuses a draft, fix it the way the answer says and save it again. Do not work around a playbook rule.
- An empty slot without good material stays empty. Say which ones.
`;
}

/** The names of the tools the skill describes, for the test that keeps it in step with the connector. */
export const SKILL_TOOL_NAMES = TOOLS.map(([name]) => name);

/**
 * The discovery index for one deployment, with the SKILL.md digest the specification asks for.
 *
 * @param origin - The deployment's address
 */
export function skillIndex(origin: string) {
  const digest = createHash("sha256").update(skillMarkdown(origin)).digest("hex");
  return {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [{ name: SKILL_NAME, type: "skill-md", description: SKILL_DESCRIPTION, url: `/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`, digest: `sha256:${digest}` }],
  };
}
