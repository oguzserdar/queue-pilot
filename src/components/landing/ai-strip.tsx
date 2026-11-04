import styles from "./ai-strip.module.css";

/**
 * A small film strip of the assistants Queue Pilot works from, under the hero buttons. The row is drawn twice and slides
 * one row-width to the left on a loop; the ends fade out under a mask. Hover pauses it; reduced motion shows one still
 * row. Marks are the same @lobehub/icons marks the app uses, saved as SVG files and drawn as masks in their color.
 */
const assistants = [
  { name: "ChatGPT", icon: "chatgpt" },
  { name: "Claude", icon: "claude", color: "#D97757" },
  { name: "Grok", icon: "grok" },
  { name: "Cursor", icon: "cursor" },
  { name: "Codex", icon: "chatgpt" },
  { name: "Claude Code", icon: "claude", color: "#D97757" },
  { name: "Any MCP app", icon: "mcp" },
];

function Row({ hidden }: { hidden?: boolean }) {
  return (
    <ul className={styles.row} aria-hidden={hidden || undefined}>
      {assistants.map((a) => (
        <li key={a.name}>
          <span className={styles.mark} style={{ maskImage: `url(/landing/logos/${a.icon}.svg)`, WebkitMaskImage: `url(/landing/logos/${a.icon}.svg)`, background: a.color ?? "currentColor" }} aria-hidden="true" />
          {a.name}
        </li>
      ))}
    </ul>
  );
}

export function AiStrip() {
  return (
    <div className={styles.strip}>
      <p className={styles.label}>Your kept rules apply in every one of these</p>
      <div className={styles.window}>
        <div className={styles.track}>
          <Row />
          <Row hidden />
        </div>
      </div>
    </div>
  );
}
