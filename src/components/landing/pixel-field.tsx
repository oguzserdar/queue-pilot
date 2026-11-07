"use client";

import { useEffect, useRef } from "react";
import styles from "./pixel-field.module.css";

/**
 * A still dithered pixel field: 4px squares ordered by a Bayer matrix, painted once per size. "hero" grows toward the
 * right edge so the text side stays plain; "band" fills only the band's bottom padding, rising toward the bottom edge, so nothing sits behind text or buttons. It carries no motion.
 * Any element inside the same parent marked `data-field-frame` gets a clean border of empty cells around it, snapped to
 * the grid, so a picture sits inside the pattern like a framed cut-out instead of being laid over it.
 */
const FRAME_GAP = 2; // cells of clear space between a framed element and the dots
const PIXEL = 4;
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const threshold = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

export function PixelField({ placement = "hero" }: { placement?: "hero" | "band" }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const g = canvas?.getContext("2d");
    if (!canvas || !g) return;
    const paint = () => {
      const w = Math.max(1, Math.round(canvas.clientWidth / PIXEL));
      const h = Math.max(1, Math.round(canvas.clientHeight / PIXEL));
      canvas.width = w; canvas.height = h;
      g.clearRect(0, 0, w, h);
      g.fillStyle = getComputedStyle(canvas).color;
      const box = canvas.getBoundingClientRect();
      const holes = [...(canvas.parentElement?.querySelectorAll<HTMLElement>("[data-field-frame]") ?? [])].map((el) => {
        const r = el.getBoundingClientRect();
        return {
          x0: Math.floor((r.left - box.left) / PIXEL) - FRAME_GAP, x1: Math.ceil((r.right - box.left) / PIXEL) + FRAME_GAP,
          y0: Math.floor((r.top - box.top) / PIXEL) - FRAME_GAP, y1: Math.ceil((r.bottom - box.top) / PIXEL) + FRAME_GAP,
        };
      });
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (holes.some((o) => x >= o.x0 && x < o.x1 && y >= o.y0 && y < o.y1)) continue;
        const d = placement === "hero"
          ? Math.min(1, Math.max(0, (x / w - 0.5) / 0.5)) * (0.4 + 0.6 * Math.sin((y / h) * Math.PI)) * 0.8
          : Math.min(1, y / h) * 0.7;
        if (d > threshold(x, y)) g.fillRect(x, y, 1, 1);
      }
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(canvas);
    canvas.parentElement?.querySelectorAll("[data-field-frame]").forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [placement]);

  return <canvas ref={ref} className={styles.field} data-placement={placement} aria-hidden="true" />;
}
