/**
 * The Pilot drawn still, for places where it only stands and watches. Same shapes as the hero's animated Pilot, in
 * its flying cap, goggles and wings, eyes turned down toward the text.
 */
export function PilotMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-60 -60 120 120" aria-hidden="true">
      <defs><clipPath id="pilot-mark-shell"><rect x="-46" y="-48" width="92" height="94" rx="26" /></clipPath></defs>
      <g clipPath="url(#pilot-mark-shell)">
        <rect x="-46" y="-48" width="92" height="94" fill="var(--accent)" />
        <rect x="-46" y="30" width="92" height="16" fill="var(--accent-strong)" />
      </g>
      <PilotCap shell="pilot-mark-shell" />
      <PilotGoggles />
      <rect x="-24" y="-2" width="8" height="15" rx="4" fill="var(--background)" />
      <rect x="4" y="-2" width="8" height="15" rx="4" fill="var(--background)" />
    </svg>
  );
}

/**
 * The Pilot's flying gear, drawn over its body: a leather cap with ear flaps and a goggle strap (inside the body's
 * outline), goggles pushed up on the cap, and gold wings on its base like a badge.
 */
export function PilotCap({ shell }: { shell: string }) {
  return (
    <g clipPath={`url(#${shell})`}>
      <rect x="-46" y="-48" width="92" height="23" fill="var(--pilot-cap, oklch(0.26 0.07 357))" />
      <rect x="-46" y="-25" width="13" height="25" rx="5" fill="var(--pilot-cap, oklch(0.26 0.07 357))" />
      <rect x="33" y="-25" width="13" height="25" rx="5" fill="var(--pilot-cap, oklch(0.26 0.07 357))" />
      <rect x="-1" y="-48" width="2" height="18" fill="var(--pilot-strap, oklch(0.36 0.05 357))" />
      <rect x="-46" y="-34" width="92" height="6" fill="var(--pilot-strap, oklch(0.36 0.05 357))" />
    </g>
  );
}

/** Goggles pushed up on the cap, and gold wings on the base. `glint` names the class that flashes the lenses. */
export function PilotGoggles({ glint }: { glint?: string }) {
  return (
    <>
      <rect x="-27" y="-40" width="22" height="17" rx="7" fill="var(--pilot-frame, oklch(0.66 0.13 75))" />
      <rect x="-24.5" y="-37.5" width="17" height="12" rx="5" fill="var(--pilot-lens, oklch(0.86 0.06 225))" />
      <rect x="5" y="-40" width="22" height="17" rx="7" fill="var(--pilot-frame, oklch(0.66 0.13 75))" />
      <rect x="7.5" y="-37.5" width="17" height="12" rx="5" fill="var(--pilot-lens, oklch(0.86 0.06 225))" />
      <rect x="-5" y="-33" width="10" height="4" fill="var(--pilot-frame, oklch(0.66 0.13 75))" />
      {glint ? <path className={glint} d="M-21 -36 l4 0 l-5 9 l-4 0 Z M11 -36 l4 0 l-5 9 l-4 0 Z" fill="var(--pilot-glint, oklch(1 0 0))" /> : null}
      <path d="M-3 38 C-10 33 -20 33 -27 35 C-21 37 -15 39 -9 40 Z" fill="var(--pilot-wing, oklch(0.8 0.13 85))" />
      <path d="M3 38 C10 33 20 33 27 35 C21 37 15 39 9 40 Z" fill="var(--pilot-wing, oklch(0.8 0.13 85))" />
      <circle cx="0" cy="38" r="4.2" fill="var(--pilot-wing, oklch(0.8 0.13 85))" />
      <circle cx="0" cy="38" r="1.8" fill="var(--pilot-frame, oklch(0.66 0.13 75))" />
    </>
  );
}
