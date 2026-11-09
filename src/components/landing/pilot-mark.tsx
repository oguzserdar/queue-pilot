/**
 * The Pilot drawn still, for places where it only stands and watches. Same shapes as the hero's animated Pilot, in
 * its leather flying helmet, eyes turned down toward the text.
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

const LEATHER = "var(--pilot-leather, oklch(0.37 0.07 50))";
const SEAM = "var(--pilot-seam, oklch(0.26 0.05 45))";
const SHEEN = "var(--pilot-sheen, oklch(0.5 0.08 58))";
const FLEECE = "var(--pilot-fleece, oklch(0.93 0.025 85))";
const BRASS = "var(--pilot-brass, oklch(0.8 0.12 82))";
const BRASS_DEEP = "var(--pilot-brass-deep, oklch(0.6 0.11 70))";
const LENS = "var(--pilot-lens, oklch(0.9 0.05 220))";
const LENS_SHADE = "var(--pilot-lens-shade, oklch(0.76 0.07 225))";

const DOME = "M-50 -30 V-38 C-50 -53 -34 -59 0 -59 C34 -59 50 -53 50 -38 V-30 Z";
const FLAP_L = "M-51 -32 H-39 V5 C-39 10 -42 13 -45.5 13 C-49 13 -51 10.5 -51 7 Z";
const FLAP_R = "M51 -32 H39 V5 C39 10 42 13 45.5 13 C49 13 51 10.5 51 7 Z";

/**
 * A light line around the whole Pilot, helmet included, drawn under it. Dark sections switch it on with `--pilot-halo`
 * so the dark leather never melts into the background.
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
 * The Pilot's 1930s leather flying helmet and its wings. The helmet sits on top of the head and wraps down the sides
 * the way a real one does, so the face keeps its full size and the eyes never reach the helmet: a stitched leather
 * dome with a fleece edge at the brim, side panels with sewn ear cups and a chin strap, brass goggles resting high on
 * a strap, and gold wings on the base like a badge. `glint` names the class that flashes the lenses.
 */
export function PilotGear({ glint }: { glint?: string }) {
  const lens = (cx: number) => (
    <g key={cx}>
      <circle cx={cx} cy="-45" r="9.2" fill={BRASS} />
      <circle cx={cx} cy="-45" r="9.2" fill="none" stroke={BRASS_DEEP} strokeWidth="1.2" />
      <circle cx={cx} cy="-45" r="6.4" fill={LENS} />
      <path d={`M${cx - 6.4} -45 A6.4 6.4 0 0 0 ${cx + 6.4} -45 Z`} fill={LENS_SHADE} />
      <path d={`M${cx - 4.2} -46.5 A4.4 4.4 0 0 1 ${cx - 0.5} -49.6`} fill="none" stroke="oklch(1 0 0)" strokeWidth="1.4" strokeLinecap="round" />
    </g>
  );
  return (
    <>
      {/* Side panels with ear cups, then the dome over them. */}
      <path d={FLAP_L} fill={LEATHER} stroke={SEAM} strokeWidth="1.2" />
      <path d={FLAP_R} fill={LEATHER} stroke={SEAM} strokeWidth="1.2" />
      {[-45, 45].map((x) => (
        <g key={x}>
          <ellipse cx={x} cy="-12" rx="4.6" ry="7.5" fill={SEAM} />
          <ellipse cx={x} cy="-12" rx="2.8" ry="5.4" fill={SHEEN} />
          <circle cx={x} cy="-12" r="1.3" fill={BRASS} />
        </g>
      ))}
      <path d="M43 12 L41.5 22 H45.5 L47 12 Z" fill={SEAM} />
      <rect x="40.5" y="19" width="6" height="4.5" rx="1" fill="none" stroke={BRASS} strokeWidth="1.4" />
      <path d={DOME} fill={LEATHER} stroke={SEAM} strokeWidth="1.2" />
      <path d="M-38 -45 C-31 -53 -18 -56.5 -7 -56.5 C-19 -53.5 -30 -49.5 -35 -42 Z" fill={SHEEN} opacity=".75" />
      <path d="M0 -59 V-36 M-22 -56.5 Q-30 -47 -31 -36 M22 -56.5 Q30 -47 31 -36" fill="none" stroke={SEAM} strokeWidth="1.1" />
      {/* Fleece edge at the brim, with the stitch line above it. */}
      <path d="M-50 -35 Q0 -38.5 50 -35 V-29.5 Q0 -33 -50 -29.5 Z" fill={FLEECE} />
      <path d="M-47 -36.6 Q0 -40.2 47 -36.6" fill="none" stroke={SHEEN} strokeWidth="0.9" strokeDasharray="2 1.8" />
      {/* Goggles resting high on their strap. */}
      <path d="M-50 -46.5 Q0 -50 50 -46.5 V-42.5 Q0 -46 -50 -42.5 Z" fill={SEAM} />
      <rect x="-6" y="-46.8" width="12" height="3.6" rx="1.4" fill={BRASS_DEEP} />
      {lens(-15)}{lens(15)}
      {glint ? <path className={glint} d="M-18 -49 l3.5 0 l-4 7.5 l-3.5 0 Z M12 -49 l3.5 0 l-4 7.5 l-3.5 0 Z" fill="oklch(1 0 0)" /> : null}
      {/* Wings on the base. */}
      <path d="M-3 38 C-10 33 -20 33 -27 35 C-21 37 -15 39 -9 40 Z" fill={BRASS} />
      <path d="M3 38 C10 33 20 33 27 35 C21 37 15 39 9 40 Z" fill={BRASS} />
      <circle cx="0" cy="38" r="4.2" fill={BRASS} />
      <circle cx="0" cy="38" r="1.8" fill={BRASS_DEEP} />
    </>
  );
}
