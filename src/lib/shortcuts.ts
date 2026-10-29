/**
 * @fileoverview Queue Pilot's keyboard shortcuts: one table that the key handler, the shortcut help and the command
 * palette all read, so they never drift apart. Sequences use the first letter of where they go: "G then H" goes home,
 * "G then P" to the week of posts, "N then P" starts a new post.
 */

/** What a shortcut does: open a page, or one of the app-wide actions. */
export type ShortcutRun = { to: string } | { action: "palette" | "help" | "new-post" } | { inComposer: true };

/** One shortcut. A combination is pressed at once (`mod+k`); a sequence is pressed one key after another (`g`, `h`). */
export type Shortcut = {
  id: string;
  group: "General" | "Go to" | "Write";
  label: string;
  keys: string[];
  sequence: boolean;
  run: ShortcutRun;
};

const go = (letter: string, label: string, to: string): Shortcut => ({ id: `go-${to}`, group: "Go to", label, keys: ["g", letter], sequence: true, run: { to } });

export const SHORTCUTS: Shortcut[] = [
  { id: "palette", group: "General", label: "Open the quick navigator", keys: ["mod+k"], sequence: false, run: { action: "palette" } },
  { id: "help", group: "General", label: "Keyboard shortcuts", keys: ["mod+/"], sequence: false, run: { action: "help" } },
  { id: "help-key", group: "General", label: "Keyboard shortcuts", keys: ["?"], sequence: false, run: { action: "help" } },
  { id: "new-post", group: "Write", label: "New post in the next empty slot", keys: ["n", "p"], sequence: true, run: { action: "new-post" } },
  { id: "save-draft", group: "Write", label: "Save the draft you are writing", keys: ["mod+enter"], sequence: false, run: { inComposer: true } },
  go("h", "Needs you", "/"),
  go("p", "Next week", "/week"),
  go("d", "Delivery", "/delivery"),
  go("r", "Playbook", "/playbook"),
  go("v", "Voice", "/voice"),
  go("i", "New material", "/ideas"),
  go("o", "Sources", "/sources"),
  go("c", "Connect your AI", "/connect"),
  go("s", "Settings", "/settings"),
];

/** How long the second key of a sequence may wait after the first. */
export const SEQUENCE_MS = 1000;

const TYPING_ROLES = new Set(["textbox", "combobox", "listbox", "menu", "menuitem", "searchbox", "spinbutton", "slider"]);

/** True when keys typed here are text or belong to a control or dialog, so single-key shortcuts must stay out of the way. */
export function isTypingTarget(el: Element | null): boolean {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if ((el as HTMLElement).isContentEditable) return true;
  const role = el.getAttribute("role");
  if (role && TYPING_ROLES.has(role)) return true;
  return !!el.closest('[role="dialog"], [role="alertdialog"]');
}

/**
 * Follows sequence shortcuts key by key. `step` takes one plain key (no modifiers) and the time, and answers the
 * shortcut it completes, or null. A first key that starts no sequence, or a second key after SEQUENCE_MS, starts over.
 */
export function sequenceMatcher(table: Shortcut[] = SHORTCUTS) {
  const sequences = table.filter((s) => s.sequence);
  let first: string | null = null;
  let at = 0;
  return {
    step(key: string, now: number): Shortcut | null {
      if (first && now - at <= SEQUENCE_MS) {
        const hit = sequences.find((s) => s.keys[0] === first && s.keys[1] === key);
        first = null;
        if (hit) return hit;
      }
      first = sequences.some((s) => s.keys[0] === key) ? key : null;
      at = now;
      return null;
    },
    reset() {
      first = null;
    },
  };
}
