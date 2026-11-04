/**
 * The Pilot drawn still, for places where it only stands and watches (the closing band). Same shapes as the hero's
 * animated Pilot, eyes turned down toward the text.
 */
export function PilotMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="-60 -60 120 120" aria-hidden="true">
      <defs><clipPath id="pilot-mark-shell"><rect x="-46" y="-48" width="92" height="94" rx="26" /></clipPath></defs>
      <g clipPath="url(#pilot-mark-shell)">
        <rect x="-46" y="-48" width="92" height="94" fill="var(--accent)" />
        <rect x="-46" y="30" width="92" height="16" fill="var(--accent-strong)" />
      </g>
      <rect x="-24" y="-2" width="8" height="15" rx="4" fill="var(--background)" />
      <rect x="4" y="-2" width="8" height="15" rx="4" fill="var(--background)" />
    </svg>
  );
}
