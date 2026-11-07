"use client";

import { useEffect, useRef } from "react";
import styles from "./pixel-field.module.css";

/**
 * A still dithered pixel field: 4px squares ordered by a Bayer matrix, painted once per size. "hero" grows toward the
 * right edge so the text side stays plain; "band" fills only the band's bottom padding, rising toward the bottom edge, so nothing sits behind text or buttons. It carries no motion.
 * An element inside the same parent marked `data-field-frame` pulls the pattern toward it: the dots grow denser the
 * closer they get, right up to its edge, so a picture melts into the field instead of sitting on it. An element marked
 * `data-field-clear` gets no dots behind it, so text over the field stays readable.
 */
const HALO = 7; // cells over which the pull toward a framed element fades out
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
      const cells = (selector: string) => [...(canvas.parentElement?.querySelectorAll<HTMLElement>(selector) ?? [])].map((el) => {
        const r = el.getBoundingClientRect();
        return { x0: Math.floor((r.left - box.left) / PIXEL), x1: Math.ceil((r.right - box.left) / PIXEL), y0: Math.floor((r.top - box.top) / PIXEL), y1: Math.ceil((r.bottom - box.top) / PIXEL) };
      });
      const frames = cells("[data-field-frame]"), clear = cells("[data-field-clear]");
      const inside = (o: { x0: number; x1: number; y0: number; y1: number }, x: number, y: number) => x >= o.x0 && x < o.x1 && y >= o.y0 && y < o.y1;
      // How close a cell is to the nearest framed edge, 1 at the edge and 0 at HALO cells away.
      const pull = (x: number, y: number) => Math.max(0, ...frames.map((o) => {
        const dx = Math.max(o.x0 - x - 1, 0, x - o.x1), dy = Math.max(o.y0 - y - 1, 0, y - o.y1);
        return 1 - Math.min(1, Math.hypot(dx, dy) / HALO);
      }));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (clear.some((o) => inside(o, x, y)) || frames.some((o) => inside(o, x, y))) continue;
        const d = placement === "hero"
          ? Math.min(1, Math.max(0, (x / w - 0.5) / 0.5)) * (0.4 + 0.6 * Math.sin((y / h) * Math.PI)) * 0.8
          : Math.min(1, y / h) * 0.7;
        const p = placement === "hero" ? pull(x, y) : 0;
        if (Math.max(d, p * p * 0.95) > threshold(x, y)) g.fillRect(x, y, 1, 1);
      }
    };
    paint();
    const ro = new ResizeObserver(paint);
    ro.observe(canvas);
    canvas.parentElement?.querySelectorAll("[data-field-frame], [data-field-clear]").forEach((el) => ro.observe(el));
    return () => ro.disconnect();
  }, [placement]);

  return <canvas ref={ref} className={styles.field} data-placement={placement} aria-hidden="true" />;
}
