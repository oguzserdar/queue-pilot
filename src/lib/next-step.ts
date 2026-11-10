/**
 * @fileoverview The one or two suggestions shown as toasts after someone writes or saves drafts in the app: add a
 * feed, pick a voice, or connect the AI they already use. The app works without any of them; each toast names the
 * step that would make the next run better and links to it.
 */

/** A suggestion with the page that acts on it. */
export type NextStep = { id: "add-feed" | "ai-used-up" | "pick-voice" | "connect-ai"; tone: "info" | "warning"; title: string; description: string; action: { label: string; href: string } };

const STEPS: Record<NextStep["id"], NextStep> = {
  "add-feed": { id: "add-feed", tone: "warning", title: "Add a feed first", description: "Queue Pilot writes from what you publish: your newsletter, blog, videos or releases.", action: { label: "Add a feed", href: "/sources" } },
  "ai-used-up": { id: "ai-used-up", tone: "warning", title: "Built-in AI is used up for today", description: "Your own AI is not counted here. Connect it and ask it to fill your week.", action: { label: "Connect", href: "/connect" } },
  "pick-voice": { id: "pick-voice", tone: "info", title: "These drafts don't know your voice yet", description: "Pick a few of your own posts and the next drafts sound like you.", action: { label: "Pick posts", href: "/voice" } },
  "connect-ai": { id: "connect-ai", tone: "info", title: "Your own AI can do this too", description: "Connect Claude, ChatGPT or Grok and ask it to fill your week, on the plan you already pay for.", action: { label: "Connect", href: "/connect" } },
};

/**
 * What to suggest after a run.
 *
 * @param run - How the run ended: drafts `saved`, or stopped for `no-material` or `ai-used-up`; anything else suggests nothing
 * @param account - Whether the person has a voice set and an AI app that has really called Queue Pilot
 * @returns At most two suggestions, the one that unblocks them first
 */
export function nextSteps(run: { saved: number; reason?: "no-material" | "ai-used-up" }, account: { hasVoice: boolean; hasAiApp: boolean }): NextStep[] {
  if (run.reason === "no-material") return [STEPS["add-feed"]];
  if (run.reason === "ai-used-up") return account.hasAiApp ? [] : [STEPS["ai-used-up"]];
  if (run.saved === 0) return [];
  return [...(account.hasVoice ? [] : [STEPS["pick-voice"]]), ...(account.hasAiApp ? [] : [STEPS["connect-ai"]])];
}
