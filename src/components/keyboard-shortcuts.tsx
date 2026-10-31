"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CommandPalette, type CommandItem } from "@/registry/components/command-palette/command-palette";
import { Dialog, DialogContent } from "@/registry/components/dialog/dialog";
import { formatShortcut, Kbd, matchesShortcut, usePlatform } from "@/registry/components/shortcut-recorder/shortcut-recorder";
import { Switch } from "@/registry/components/switch/switch";
import { isTypingTarget, SHORTCUTS, sequenceMatcher, type Shortcut } from "@/lib/shortcuts";
import styles from "./keyboard-shortcuts.module.css";

/** Browser storage key for the single-key switch: a per-viewer preference, so it lives in this browser only. */
const SINGLE_KEYS = "qp-single-key-shortcuts";
/** Fired on the window to open the composer on the week's next empty slot. */
export const NEW_POST_EVENT = "qp:new-post";
/** Fired on the window with a page action's name ("approve", "share", "add-rule") for the page that owns it. */
export const PAGE_ACTION_EVENT = "qp:do";
/** Which page owns each palette action. */
const ACTION_PAGE: Record<string, string> = { approve: "/week", share: "/week", "add-rule": "/playbook" };

function readSingleKeys(): boolean {
  try {
    return localStorage.getItem(SINGLE_KEYS) !== "off";
  } catch {
    return true;
  }
}

/**
 * The app's keyboard: one listener for the whole app, the shortcut help (? or Cmd/Ctrl+/) and the quick navigator
 * (Cmd/Ctrl+K). Single-key shortcuts (G then a letter, N then P, ?) never fire while typing or inside a dialog, and can be
 * switched off for voice control; shortcuts with Cmd/Ctrl always work.
 */
export function KeyboardShortcuts() {
  const router = useRouter();
  const path = usePathname();
  const platform = usePlatform();
  const [open, setOpen] = useState<"palette" | "help" | null>(null);
  const [singleKeys, setSingleKeys] = useState(true);
  const matcher = useRef(sequenceMatcher());

  useEffect(() => setSingleKeys(readSingleKeys()), []);

  const run = (s: Shortcut) => {
    if ("to" in s.run) return router.push(s.run.to);
    if ("inComposer" in s.run) return;
    if (s.run.action === "new-post") {
      if (path === "/week") window.dispatchEvent(new Event(NEW_POST_EVENT));
      else router.push("/week?new=1");
      return;
    }
    setOpen(s.run.action);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat || e.isComposing) return;
      const combo = SHORTCUTS.find((s) => !s.sequence && "action" in s.run && s.keys[0].startsWith("mod+") && matchesShortcut(e, s.keys[0], platform));
      if (combo) {
        e.preventDefault();
        matcher.current.reset();
        const which = (combo.run as { action: "palette" | "help" }).action;
        setOpen((o) => (o === which ? null : which));
        return;
      }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || isTypingTarget(document.activeElement) || !singleKeys) {
        matcher.current.reset();
        return;
      }
      if (e.key === "?") {
        e.preventDefault();
        setOpen("help");
        return;
      }
      const hit = matcher.current.step(e.key.toLowerCase(), performance.now());
      if (hit) {
        e.preventDefault();
        run(hit);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  const toggleSingleKeys = (on: boolean) => {
    setSingleKeys(on);
    try {
      localStorage.setItem(SINGLE_KEYS, on ? "on" : "off");
    } catch {}
  };

  // A page action runs on the page that owns it, opening that page first when needed.
  const doAction = (name: string) => {
    const page = ACTION_PAGE[name];
    if (path === page) window.dispatchEvent(new CustomEvent(PAGE_ACTION_EVENT, { detail: name }));
    else router.push(`${page}?do=${name}`);
  };

  const items: CommandItem[] = useMemo(
    () => [
      { id: "do:approve", label: "Approve ready drafts", group: "Actions", shortcut: "A" },
      { id: "do:share", label: "Share drafts for review", group: "Actions" },
      { id: "new-post", label: "Write a post in the next empty slot", group: "Actions", shortcut: "N P" },
      { id: "do:add-rule", label: "Add a rule", group: "Actions" },
      ...SHORTCUTS.filter((s) => "to" in s.run).map((s) => ({ id: s.id, label: s.label, group: "Go to", shortcut: s.keys.join(" ").toUpperCase() })),
      { id: "go-/reviews", label: "Reviews", group: "Go to" },
      { id: "help", label: "Keyboard shortcuts", group: "Help", shortcut: formatShortcut("mod+/", platform).text },
    ],
    [platform],
  );

  const groups = ["General", "Write", "Go to"] as const;
  const keyCaps = (s: Shortcut) =>
    s.sequence
      ? s.keys.map((k, i) => <Fragment key={k + i}>{i > 0 && <span className={styles.then}>then</span>}<Kbd size="sm">{k.toUpperCase()}</Kbd></Fragment>)
      : s.keys[0] === "?"
        ? <Kbd size="sm">?</Kbd>
        : <Kbd size="sm">{formatShortcut(s.keys[0], platform).text}</Kbd>;

  return (
    <>
      <Dialog open={open === "palette"} onOpenChange={(o) => setOpen(o ? "palette" : null)}>
        {open === "palette" && (
          <DialogContent className={styles.paletteDialog} title="Do or go anywhere" description="Approve, share, write, add a rule, or open a page.">
            <CommandPalette
              autoFocus
              items={items}
              placeholder="Type a command or a page…"
              onClose={() => setOpen(null)}
              onSelect={(item) => {
                setOpen(null);
                if (item.id.startsWith("do:")) return doAction(item.id.slice(3));
                if (item.id === "go-/reviews") return router.push("/reviews");
                const s = SHORTCUTS.find((x) => x.id === item.id);
                if (s) run(s);
              }}
            />
          </DialogContent>
        )}
      </Dialog>
      <Dialog open={open === "help"} onOpenChange={(o) => setOpen(o ? "help" : null)}>
        {open === "help" && (
          <DialogContent className={styles.helpDialog} title="Keyboard shortcuts" description="Shortcuts work anywhere except while you type.">
            <div className={styles.groups}>
              {groups.map((g) => (
                <section key={g} className={styles.group} aria-label={g}>
                  <h3 className={styles.groupTitle}>{g}</h3>
                  <ul className={styles.rows}>
                    {SHORTCUTS.filter((s) => s.group === g && s.id !== "help-key").map((s) => {
                      const off = !singleKeys && (s.sequence || s.keys[0] === "?");
                      return (
                        <li key={s.id} className={styles.row} data-off={off || undefined}>
                          <span>{s.label}</span>
                          <span className={styles.keys}>
                            {s.id === "help" ? <><Kbd size="sm">?</Kbd><span className={styles.then}>or</span>{keyCaps(s)}</> : keyCaps(s)}
                            {off && <span className={styles.offNote}>Off</span>}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>
            <div className={styles.switchRow}>
              <Switch label="Single-key shortcuts" checked={singleKeys} onCheckedChange={toggleSingleKeys} />
              <p className={styles.switchNote}>Turn off if you use voice control. Shortcuts with {platform === "mac" ? "⌘" : "Ctrl"} keep working.</p>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
