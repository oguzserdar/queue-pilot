import { postgresAiKeyStore } from "./ai-key-store";
import { allowanceFor } from "./judge-model";

export type WritingAvailability =
  | { ready: true; source: "your key" | "built-in AI" }
  | { ready: false; message: string };

/** Read configuration and remaining allowance without reserving or spending an AI action. The action checks again. */
export async function writingAvailabilityFor(userId: string): Promise<WritingAvailability> {
  const master = process.env.SETTINGS_KEY;
  if (!master) return { ready: false, message: "AI writing is unavailable just now." };
  try {
    const own = await postgresAiKeyStore(master).shown(userId);
    if (own) return { ready: true, source: "your key" };
    const allowance = await allowanceFor(userId);
    if (!allowance) return { ready: false, message: "Built-in AI is off. You can add your own key in Settings." };
    if (allowance.leftUsd <= 0) return { ready: false, message: "The shared AI budget is used up for now. You can use your own key in Settings." };
    if (allowance.used >= allowance.cap || allowance.totalRemaining <= 0)
      return { ready: false, message: "The built-in AI allowance is used up for today. It resets at midnight UTC, or you can use your own key." };
    return { ready: true, source: "built-in AI" };
  } catch {
    return { ready: false, message: "Could not check AI availability. Refresh and try again." };
  }
}
