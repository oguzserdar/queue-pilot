"use client";

import { useEffect, useRef, useState } from "react";

/**
 * A button that confirms on itself: after a save, its label reads the result (for example "Saved") for a moment, so
 * the eye stays where the click was instead of looking for a message in the corner.
 *
 * @returns `confirmed` while the label should show the result, and `confirm()` to start it.
 * @example
 * const [saved, confirmSaved] = useConfirmed();
 * <Button>{saved ? "✓ Saved" : "Save key"}</Button>
 */
export function useConfirmed(ms = 1800): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return [on, () => {
    if (timer.current) clearTimeout(timer.current);
    setOn(true);
    timer.current = setTimeout(() => setOn(false), ms);
  }];
}
