/**
 * The Pilot drawn still, for places where it only stands and watches. Same shapes as the hero's animated Pilot, in
 * its flying helmet, eyes turned down toward the text.
 */
export function PilotMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-60 -60 120 120" aria-hidden="true">
      <defs><clipPath id="pilot-mark-shell"><rect x="-46" y="-48" width="92" height="94" rx="26" /></clipPath></defs>
      <g clipPath="url(#pilot-mark-shell)">
        <rect x="-46" y="-48" width="92" height="94" fill="var(--accent)" />
        <rect x="-46" y="30" width="92" height="16" fill="var(--accent-strong)" />
      </g>
      <PilotGear />
      <rect x="-24" y="-2" width="8" height="15" rx="4" fill="var(--background)" />
      <rect x="4" y="-2" width="8" height="15" rx="4" fill="var(--background)" />
    </svg>
  );
}

/* Brand colours only: the night tone of the dark sections, a cream edge, and the gold of the wings. */
const HELMET = "var(--pilot-helmet, oklch(0.26 0.07 357))";
const EAR = "var(--pilot-ear, oklch(0.34 0.08 357))";
const CREAM = "var(--pilot-cream, oklch(0.93 0.025 85))";
const GOLD = "var(--pilot-gold, oklch(0.8 0.12 82))";
const LENS = "var(--pilot-lens, oklch(0.2 0.05 357))";

const DOME = "M-50 -30 V-36 C-50 -48 -38 -59.5 0 -59.5 C38 -59.5 50 -48 50 -36 V-30 Z";
const FLAP_L = "M-51 -32 H-39 V5 C-39 10 -42 13 -45.5 13 C-49 13 -51 10.5 -51 7 Z";
const FLAP_R = "M51 -32 H39 V5 C39 10 42 13 45.5 13 C49 13 51 10.5 51 7 Z";

/**
 * A light line around the whole Pilot, helmet included, drawn under it. Dark sections switch it on with `--pilot-halo`
 * so the dark helmet never melts into the background.
 */
export function PilotHalo() {
  return (
    <g fill="none" stroke="var(--pilot-halo, transparent)" strokeWidth="5" strokeLinejoin="round">
      <rect x="-46" y="-48" width="92" height="94" rx="26" />
      <path d={DOME} /><path d={FLAP_L} /><path d={FLAP_R} />
    </g>
  );
}

/**
 * The Pilot's flying helmet and its wings, flat, in the brand's colours. The helmet sits on top of the head and wraps
 * down the sides like a real one, so the face keeps its full size and the eyes never reach it: one dark shape with a
 * cream edge at the brim and an ear cup on each side, gold-rimmed goggles with dark lenses resting high on it (dark,
 * so they never read as a second pair of eyes), and gold wings on the base like a badge.
 */
export function PilotGear() {
  return (
    <>
      <path d={FLAP_L} fill={HELMET} />
      <path d={FLAP_R} fill={HELMET} />
      <ellipse cx="-45" cy="-12" rx="3.6" ry="6.5" fill={EAR} />
      <ellipse cx="45" cy="-12" rx="3.6" ry="6.5" fill={EAR} />
      <path d={DOME} fill={HELMET} />
      <path d="M-50 -35 Q0 -38.5 50 -35 V-30 Q0 -33.5 -50 -30 Z" fill={CREAM} />
      {[-15, 15].map((cx) => (
        <circle key={cx} cx={cx} cy="-46" r="7.5" fill={LENS} stroke={GOLD} strokeWidth="2.6" />
      ))}
      <rect x="-7.5" y="-47.3" width="15" height="2.6" rx="1.3" fill={GOLD} />
      <path d="M-3 38 C-10 33 -20 33 -27 35 C-21 37 -15 39 -9 40 Z" fill={GOLD} />
      <path d="M3 38 C10 33 20 33 27 35 C21 37 15 39 9 40 Z" fill={GOLD} />
      <circle cx="0" cy="38" r="4.2" fill={GOLD} />
    </>
  );
}
