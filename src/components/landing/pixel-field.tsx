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
const HALO = 9; // cells over which the pull toward a framed element fades out
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
      // One grid for everything: when a pixel picture is framed in the field, the dots take its pixel size and line up
      // with its pixels, so the two read as one drawing. Otherwise 4px squares.
      const box = canvas.getBoundingClientRect();
      const frameEls = [...(canvas.parentElement?.querySelectorAll<HTMLElement>("[data-field-frame]") ?? [])];
      const lead = frameEls[0]?.getBoundingClientRect();
      const cell = lead && frameEls[0].dataset.fieldCells ? lead.width / Number(frameEls[0].dataset.fieldCells) : PIXEL;
      const ox = lead ? (((lead.left - box.left) % cell) + cell) % cell : 0, oy = lead ? (((lead.top - box.top) % cell) + cell) % cell : 0;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(box.width * dpr); canvas.height = Math.round(box.height * dpr);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.clearRect(0, 0, box.width, box.height);
      g.fillStyle = getComputedStyle(canvas).color;
      const w = Math.ceil(box.width / cell) + 1, h = Math.ceil(box.height / cell) + 1;
      const toCells = (el: HTMLElement) => {
        const r = el.getBoundingClientRect();
        return { x0: Math.round((r.left - box.left - ox) / cell), x1: Math.round((r.right - box.left - ox) / cell), y0: Math.round((r.top - box.top - oy) / cell), y1: Math.round((r.bottom - box.top - oy) / cell) };
      };
      const frames = frameEls.map(toCells);
      const clear = [...(canvas.parentElement?.querySelectorAll<HTMLElement>("[data-field-clear]") ?? [])].map(toCells);
      type Area = { x0: number; x1: number; y0: number; y1: number };
      const inside = (o: Area, x: number, y: number) => x >= o.x0 && x < o.x1 && y >= o.y0 && y < o.y1;
      // A framed picture's corner pixels are notched, pixel style, so the dots may fill them.
      const corner = (o: Area, x: number, y: number) => (x === o.x0 || x === o.x1 - 1) && (y === o.y0 || y === o.y1 - 1);
      // How close a cell is to the nearest framed edge: 1 right beside it, 0 at HALO cells away.
      const pull = (x: number, y: number) => Math.max(0, ...frames.map((o) => {
        const dx = Math.max(o.x0 - x - 1, 0, x - o.x1), dy = Math.max(o.y0 - y - 1, 0, y - o.y1);
        return 1 - Math.min(1, Math.hypot(dx, dy) / HALO);
      }));
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        if (clear.some((o) => inside(o, x, y))) continue;
        if (frames.some((o) => inside(o, x, y) && !corner(o, x, y))) continue;
        const d = placement === "hero"
          ? Math.min(1, Math.max(0, (x / w - 0.5) / 0.5)) * (0.4 + 0.6 * Math.sin((y / h) * Math.PI)) * 0.8
          : Math.min(1, y / h) * 0.7;
        // Denser toward the picture, but never solid, so no band forms: at most about half the cells.
        const p = placement === "hero" ? pull(x, y) * 0.55 : 0;
        if (Math.max(d, p) <= threshold(x, y)) continue;
        // Whole device pixels at both edges, so neighbouring squares meet without hairline seams.
        const left = Math.round((ox + x * cell) * dpr) / dpr, top = Math.round((oy + y * cell) * dpr) / dpr;
        g.fillRect(left, top, Math.round((ox + (x + 1) * cell) * dpr) / dpr - left, Math.round((oy + (y + 1) * cell) * dpr) / dpr - top);
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
