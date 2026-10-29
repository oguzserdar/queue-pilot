"use client";

import { Claude, Cursor, Grok, OpenAI } from "@lobehub/icons";
import type { ComponentType } from "react";

/**
 * Provider logos from @lobehub/icons, which tracks each provider's official mark.
 * Claude renders in its brand color; OpenAI and Grok render in the current text color so they read on any surface.
 * An AI without a logo in the set gets no mark: a wrong logo is worse than none.
 */
type MarkProps = { size?: number; className?: string };

const MARKS: Record<string, ComponentType<MarkProps>> = {
  Claude: ({ size = 14, className }) => <Claude.Color size={size} className={className} />,
  ChatGPT: ({ size = 14, className }) => <OpenAI size={size} className={className} />,
  Grok: ({ size = 14, className }) => <Grok size={size} className={className} />,
  // Claude Code and Codex carry their makers' marks, as on their own sites.
  "Claude Code": ({ size = 14, className }) => <Claude.Color size={size} className={className} />,
  Codex: ({ size = 14, className }) => <OpenAI size={size} className={className} />,
  Cursor: ({ size = 14, className }) => <Cursor size={size} className={className} />,
};

/** The logo for an AI by its display name, or nothing when we ship no logo for it. */
export function AiMark({ name, size = 14, className }: { name: string } & MarkProps) {
  const Mark = MARKS[name];
  return Mark ? <Mark size={size} className={className} /> : null;
}
