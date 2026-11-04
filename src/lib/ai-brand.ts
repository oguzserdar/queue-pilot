/** Display marks only. A familiar name is not a claim that an OAuth client is verified. */
export function aiBrand(name: string): string | null {
  const brands: Record<string, string> = {
    "claude.ai": "Claude", claude: "Claude", "claude code": "Claude Code",
    "chatgpt.com": "ChatGPT", chatgpt: "ChatGPT", codex: "Codex",
    "grok.com": "Grok", grok: "Grok", "grok web": "Grok", "grok bot desktop": "Grok",
    cursor: "Cursor",
  };
  return brands[name.trim().toLowerCase()] ?? null;
}
