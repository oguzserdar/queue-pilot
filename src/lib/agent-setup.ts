/**
 * The setup instructions a coding agent fetches and follows to connect itself to this deployment: install the
 * Queue Pilot skill and add the connector, per agent. The Connect page copies one line that points at it, so the
 * person pastes one sentence instead of following steps. Every command carries this deployment's own address.
 */
import { PLUGIN_SKILL_FILES, PLUGIN_SKILLS } from "./plugin-skills";
import { SKILL_NAME } from "./skill-name";

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
  const names = [SKILL_NAME, ...Object.keys(PLUGIN_SKILLS)];
  // Every install route gets the same skills: the main one and the task skills the plugin ships.
  const fetchFile = (dir: string, n: string, path: string) => {
    const folder = path.includes("/") ? `${dir}/${n}/${path.slice(0, path.lastIndexOf("/"))}` : `${dir}/${n}`;
    return `mkdir -p ${folder} && curl -fsSL ${origin}/.well-known/agent-skills/${n}/${path} -o ${dir}/${n}/${path}`;
  };
  // A skill's reference files go beside its SKILL.md, at the paths its links use.
  const fetchSkills = (dir: string) => names.flatMap((n) => [fetchFile(dir, n, "SKILL.md"), ...Object.keys(PLUGIN_SKILL_FILES[n] ?? {}).map((p) => fetchFile(dir, n, p))]).join("\n");
  const skill = `${origin}/.well-known/agent-skills/${SKILL_NAME}/SKILL.md`;
  return `These are the setup instructions for Queue Pilot at ${origin}. Queue Pilot connects you to the user's Buffer queue: you write the posts, it checks each draft and saves it in Buffer for the user to approve.

Complete the steps for your agent yourself by running the commands. Do not ask the user to run them. Sign-in happens in the browser with the user's Buffer account the first time you use a Queue Pilot tool.

---

## Claude Code

Run \`claude mcp list\` first. If queue-pilot is already listed, for example from the Queue Pilot plugin, skip the \`claude mcp add\` line: a second copy would show every tool twice.

\`\`\`
${fetchSkills("~/.claude/skills")}
claude mcp add --transport http --scope user queue-pilot ${mcp}
\`\`\`

Then tell the user to run \`/mcp\` inside Claude Code and sign in to queue-pilot with Buffer. If the skills folder is new, run \`/reload-skills\`.

## Codex

\`\`\`
${fetchSkills("~/.agents/skills")}
codex mcp add queue-pilot --url ${mcp}
\`\`\`

\`codex mcp add\` opens the Buffer sign-in itself. Only if no browser opened, run \`codex mcp login queue-pilot\`.

## Cursor

\`\`\`
${fetchSkills("~/.cursor/skills")}
\`\`\`

Add this under "mcpServers" in \`~/.cursor/mcp.json\`, keeping the entries already there:

\`\`\`json
"queue-pilot": { "url": "${mcp}" }
\`\`\`

Then open Cursor's Customize page, find queue-pilot under MCP servers, and complete its OAuth sign-in with Buffer. Preserve any other servers already configured. For the first test, open a new chat and choose This Mac in the environment selector: the configuration above is installed locally. Call get_setup_status and list_my_drafts there. A Cloud chat may need its own connection. This is Cursor's coding-agent connection, separate from Grok Bot's Connect apps.

## Any other agent

Save ${skill} as \`${SKILL_NAME}/SKILL.md\` in your skills folder, along with the others listed at ${origin}/.well-known/agent-skills/index.json, and add a remote MCP server (Streamable HTTP) named queue-pilot at ${mcp}. Sign-in starts on first use.

---

A server that is listed but asks for authentication is installed, not connected. Do not say it is connected until the sign-in is done and a real call works: once the user has signed in, call \`get_setup_status\`. If it answers, tell the user:

\`\`\`
Queue Pilot connected
  Skill   <path>
  Server  queue-pilot, ${mcp}
Restart your agent, then ask it to fill your week.
\`\`\`

If you cannot sign in yourself, or the call asks for authentication, tell the user this instead:

\`\`\`
Queue Pilot installed, sign-in still needed
  Skill   <path>
  Server  queue-pilot, ${mcp}
Sign in with Buffer from your agent's MCP settings, then ask it to fill your week.
\`\`\`
`;
}

/**
 * Everything one paste gives a chat AI to get the person started: how to connect Queue Pilot in that app (followed
 * one step at a time, only when its tools are missing), a first preview that saves nothing, and Queue Pilot's own
 * fill-week instructions, so an app that cannot install skills still writes the Queue Pilot way.
 *
 * @param app - The app's name as the person picked it, for example "ChatGPT"
 * @param connectorUrl - This deployment's MCP address
 * @param steps - That app's own connection steps, as the Connect page lists them
 * @param skill - The fill-week SKILL.md text
 * @returns The text to paste into the app
 */
export function chatHandoff(app: string, connectorUrl: string, steps: string[], skill: string): string {
  const body = skill.replace(/^---[\s\S]*?---\s*/, "").trim();
  const how = steps.map((s, i) => `   ${i + 1}. ${s.replace(/the URL above/g, "Queue Pilot's address")}.`).join("\n");
  return `I want to use Queue Pilot with you. Queue Pilot connects you to my Buffer account, so you can write my social posts from what I publish and save them in Buffer as drafts for me to approve. Please guide me through it, one step at a time, in plain words.

1. Check whether you can use Queue Pilot's tools here, for example get_setup_status. If you can, go to step 3.
2. If you cannot, help me add Queue Pilot to ${app}. Give me one step, wait until I say it is done, then give the next:
${how}
   Queue Pilot's address: ${connectorUrl}
   There is no API key. I sign in with my Buffer account, and Queue Pilot shows me what you will be allowed to do before I allow it.
   When I am done, I will start a new chat and paste this message again.
3. Call get_setup_status and tell me in two or three plain sentences what is set up and what is still missing.
4. Then show me one preview post for my next empty time, written from my newest post. Show it here only. Do not save, schedule or publish anything.

When I later ask you to fill my week, follow Queue Pilot's own instructions below.

${body}
`;
}
