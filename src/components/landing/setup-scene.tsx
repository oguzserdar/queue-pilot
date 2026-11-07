"use client";

import { useEffect, useRef } from "react";
import { SCENE_SIZE, SETUP_SCENES } from "./setup-scenes";
import styles from "./setup-scene.module.css";

/**
 * One "Run your own copy" step as live pixel art (setup-scenes.ts), drawn on a 72x48 canvas that CSS scales up
 * with crisp edges. Twelve frames a second, only while on screen; reduced motion draws one still frame.
 */
export function SetupScene({ step, className }: { step: 0 | 1 | 2 | 3; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const g = ref.current?.getContext("2d");
    if (!ref.current || !g) return;
    const draw = SETUP_SCENES[step];
    const still = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const begin = performance.now();
    let frame = 0, last = 0, inView = false;
    draw(g, 0.4);
    const loop = (now: number) => {
      if (!inView) return;
      if (now - last > 83) { last = now; draw(g, (now - begin) / 1000); }
      frame = requestAnimationFrame(loop);
    };
    const seen = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      cancelAnimationFrame(frame);
      if (inView && !still) frame = requestAnimationFrame(loop);
    });
    seen.observe(ref.current);
    return () => { cancelAnimationFrame(frame); seen.disconnect(); };
  }, [step]);
  return <canvas ref={ref} width={SCENE_SIZE.width} height={SCENE_SIZE.height} className={[styles.scene, className].filter(Boolean).join(" ")} aria-hidden="true" />;
}
