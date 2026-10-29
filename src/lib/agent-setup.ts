/**
 * The setup instructions a coding agent fetches and follows to connect itself to this deployment: install the
 * Queue Pilot skill and add the connector, per agent. The Connect page copies one line that points at it, so the
 * person pastes one sentence instead of following steps. Every command carries this deployment's own address.
 */
import { SKILL_NAME } from "./agent-skill";

/** The one line the Connect page copies. */
export function setupLine(origin: string): string {
  return `Fetch and follow the instructions to connect me to Queue Pilot from ${origin}/agent-setup/prompt.md`;
}

/**
 * The prompt.md text for one deployment.
 *
 * @param origin - The deployment's address, such as https://queue-pilot.example.com
 */
export function setupPrompt(origin: string): string {
  const mcp = `${origin}/api/mcp`;
  const skill = `${origin}/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`;
  const fetchSkill = (dir: string) => `mkdir -p ${dir}/${SKILL_NAME} && curl -fsSL ${skill} -o ${dir}/${SKILL_NAME}/SKILL.md`;
  return `These are the setup instructions for Queue Pilot at ${origin}. Queue Pilot connects you to the user's Buffer queue: you write the posts, it checks each draft and saves it in Buffer for the user to approve.

Complete the steps for your agent yourself by running the commands. Do not ask the user to run them. Sign-in happens in the browser with the user's Buffer account the first time you use a Queue Pilot tool.

---

## Claude Code

\`\`\`
${fetchSkill("~/.claude/skills")}
claude mcp add --transport http --scope user queue-pilot ${mcp}
\`\`\`

Then tell the user to run \`/mcp\` inside Claude Code and sign in to queue-pilot with Buffer.

## Codex

\`\`\`
${fetchSkill("~/.codex/skills")}
codex mcp add queue-pilot --url ${mcp}
codex mcp login queue-pilot
\`\`\`

## Cursor

\`\`\`
${fetchSkill("~/.cursor/skills")}
\`\`\`

Add this under "mcpServers" in \`~/.cursor/mcp.json\`, keeping the entries already there:

\`\`\`json
"queue-pilot": { "url": "${mcp}" }
\`\`\`

## Any other agent

Save ${skill} as \`${SKILL_NAME}/SKILL.md\` in your skills folder, and add a remote MCP server (Streamable HTTP) named queue-pilot at ${mcp}. Sign-in starts on first use.

---

Once done, tell the user:

\`\`\`
Queue Pilot connected
  Skill   <path>
  Server  queue-pilot, ${mcp}
Restart your agent, then ask it to fill your week.
\`\`\`
`;
}
