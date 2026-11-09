/**
 * The Pilot drawn still, for places where it only stands and watches. Same shapes as the hero's animated Pilot, in
 * its flying cap and goggles, eyes turned down toward the text.
 */
export function PilotMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-60 -60 120 120" aria-hidden="true">
      <defs><clipPath id="pilot-mark-shell"><rect x="-46" y="-48" width="92" height="94" rx="26" /></clipPath></defs>
      <g clipPath="url(#pilot-mark-shell)">
        <rect x="-46" y="-48" width="92" height="94" fill="var(--accent)" />
        <rect x="-46" y="30" width="92" height="16" fill="var(--accent-strong)" />
      </g>
      <PilotGear shell="pilot-mark-shell" />
      <rect x="-24" y="-2" width="8" height="15" rx="4" fill="var(--background)" />
      <rect x="4" y="-2" width="8" height="15" rx="4" fill="var(--background)" />
    </svg>
  );
}

const CAP = "var(--pilot-cap, oklch(0.26 0.07 357))";
const STRAP = "var(--pilot-strap, oklch(0.36 0.05 357))";
const FRAME = "var(--pilot-frame, oklch(0.66 0.13 75))";
const LENS = "var(--pilot-lens, oklch(0.86 0.06 225))";
const GOLD = "var(--pilot-gold, oklch(0.8 0.13 85))";

/**
 * A light line around the Pilot's outline, drawn under it. Dark sections switch it on with `--pilot-halo` so the dark
 * cap never melts into the background.
 */
export function PilotHalo() {
  return <rect x="-46" y="-48" width="92" height="94" rx="26" fill="none" stroke="var(--pilot-halo, transparent)" strokeWidth="5" />;
}

/**
 * The Pilot's flying cap, goggles and wings. Everything sits inside the Pilot's own outline, so its shape never
 * changes: a leather cap over the top with ear flaps hanging square from it and a goggle strap, goggles pushed up on
 * the cap, and gold wings on the base like a badge. `shell` is the id of the body's clip path; `glint` names the class
 * that sweeps a reflection across the lenses now and then.
 */
export function PilotGear({ shell, glint }: { shell: string; glint?: string }) {
  return (
    <>
      <g clipPath={`url(#${shell})`}>
        <rect x="-46" y="-48" width="92" height="23" fill={CAP} />
        <path d="M-46 -26 H-33 V-6 A6 6 0 0 1 -39 0 H-46 Z M46 -26 H33 V-6 A6 6 0 0 0 39 0 H46 Z" fill={CAP} />
        <rect x="-46" y="-34" width="92" height="6" fill={STRAP} />
      </g>
      {/* The bridge runs into both frames, so the goggles are one piece with no seam where they meet. */}
      <rect x="-10" y="-33.5" width="20" height="4.5" fill={FRAME} />
      <rect x="-27" y="-40" width="22" height="17" rx="7" fill={FRAME} />
      <rect x="-24.5" y="-37.5" width="17" height="12" rx="5" fill={LENS} />
      <rect x="5" y="-40" width="22" height="17" rx="7" fill={FRAME} />
      <rect x="7.5" y="-37.5" width="17" height="12" rx="5" fill={LENS} />
      {glint ? (
        <>
          <clipPath id={`${shell}-lenses`}>
            <rect x="-24.5" y="-37.5" width="17" height="12" rx="5" />
            <rect x="7.5" y="-37.5" width="17" height="12" rx="5" />
          </clipPath>
          <g clipPath={`url(#${shell}-lenses)`}>
            <path className={glint} d="M-17 -40 l4 0 l-5 17 l-4 0 Z M15 -40 l4 0 l-5 17 l-4 0 Z" fill="oklch(1 0 0)" />
          </g>
        </>
      ) : null}
      <path d="M-3 38 C-10 33 -20 33 -27 35 C-21 37 -15 39 -9 40 Z M3 38 C10 33 20 33 27 35 C21 37 15 39 9 40 Z" fill={GOLD} />
      <circle cx="0" cy="38" r="4.2" fill={GOLD} />
      <circle cx="0" cy="38" r="1.8" fill={FRAME} />
    </>
  );
}
