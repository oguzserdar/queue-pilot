/**
 * The four "Run your own copy" steps drawn as pixel art, one scene per step, on a 72x48 grid that CSS scales up
 * with crisp edges. Each draw call paints the whole scene for time t (seconds): the dithered field, the Pilot, and
 * the step's object with its one motion. Same palette and Pilot as the homepage.
 */
const W = 72, H = 48;
const C = { ink: "#1C1A1F", crimson: "#8F2457", deep: "#6E1A43", pink: "#F3D6E2", dot: "#F6DCE6", grey: "#E9E7EC", white: "#FFFFFF" } as const;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const threshold = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

type G = CanvasRenderingContext2D;
const px = (g: G, x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
/** A filled box with a one-pixel ink outline and cut corners. */
const box = (g: G, x: number, y: number, w: number, h: number, fill: string) => {
  px(g, x + 1, y, w - 2, h, C.ink); px(g, x, y + 1, w, h - 2, C.ink);
  px(g, x + 1, y + 1, w - 2, h - 2, fill);
};
/** Eyes closed for about a sixth of a second every few seconds, offset per scene. */
const blinking = (t: number, offset: number) => ((t + offset) % 3.6) < 0.17;
const cycle = (t: number, length: number) => (t % length) / length;

/** The dotted pink field, sparse on the left and denser to the right, like the homepage hero. */
function field(g: G) {
  px(g, 0, 0, W, H, C.white);
  for (let y = 0; y < H; y += 2) for (let x = 0; x < W; x += 2) {
    const d = Math.min(1, Math.max(0, (x / W - 0.15) / 0.85)) * 0.55 * (0.5 + 0.5 * Math.sin((y / H) * Math.PI));
    if (d > threshold(x >> 1, y >> 1)) px(g, x, y, 1, 1, C.dot);
  }
}

/** The Pilot, 16x16: crimson body with rounded corners, darker belly, two tall white eyes. */
function pilot(g: G, x: number, y: number, closed: boolean, look = 0) {
  for (let r = 0; r < 16; r++) {
    const inset = r === 0 || r === 15 ? 3 : r === 1 || r === 14 ? 1 : 0;
    px(g, x + inset, y + r, 16 - inset * 2, 1, C.ink);
  }
  for (let r = 1; r < 15; r++) {
    const inset = r === 1 || r === 14 ? 3 : r === 2 || r === 13 ? 2 : 1;
    px(g, x + inset, y + r, 16 - inset * 2, 1, r >= 11 ? C.deep : C.crimson);
  }
  if (closed) { px(g, x + 4 + look, y + 7, 2, 1, C.white); px(g, x + 10 + look, y + 7, 2, 1, C.white); }
  else { px(g, x + 4 + look, y + 5, 2, 5, C.white); px(g, x + 10 + look, y + 5, 2, 5, C.white); }
}

/** Step 1: the Pilot turns a key in an app window; the window lights and the return arrow pulses. */
function buffer(g: G, t: number) {
  field(g);
  const p = cycle(t, 3.2);
  // The app window with its title bar and keyhole.
  box(g, 38, 12, 20, 20, C.white);
  const open = p > 0.45 && p < 0.92;
  px(g, 39, 13, 18, 3, open ? C.crimson : C.grey);
  px(g, 47, 20, 3, 3, C.deep); px(g, 48, 23, 1, 3, C.deep);
  // The key slides in, then turns: its bow is a ring, its shaft runs to the keyhole.
  const slide = Math.round(Math.min(1, p / 0.35) * 6);
  const kx = 20 + slide, ky = 22;
  // The Pilot pushes the key in, so it moves with it.
  pilot(g, 4 + slide, 18, blinking(t, 0), 1);
  px(g, kx, ky - 2, 5, 5, C.ink); px(g, kx + 1, ky - 1, 3, 3, C.crimson); px(g, kx + 2, ky, 1, 1, C.white);
  px(g, kx + 5, ky, 21 - slide, 1, C.ink);
  if (p > 0.35) px(g, 46, ky - 2, 1, 5, C.ink); else { px(g, kx + 22 - slide, ky + 1, 1, 2, C.ink); px(g, kx + 19 - slide, ky + 1, 1, 2, C.ink); }
  // The redirect: a hook from the window's side back toward it, brightening once the window opens.
  const arrow = open && Math.floor(t * 6) % 2 === 0 ? C.crimson : C.deep;
  px(g, 59, 20, 5, 1, arrow); px(g, 63, 21, 1, 9, arrow); px(g, 57, 30, 7, 1, arrow);
  px(g, 56, 29, 1, 3, arrow); px(g, 55, 30, 1, 1, arrow);
}

/** Step 2: the Pilot writes into a settings card beside a database; bars fill one at a time, a glint climbs the discs. */
function database(g: G, t: number) {
  field(g);
  const p = cycle(t, 3.6);
  pilot(g, 4, 22, blinking(t, 1.2), 1);
  box(g, 26, 14, 16, 22, C.white);
  const bars = [18, 23, 28];
  bars.forEach((y, i) => {
    const local = Math.min(1, Math.max(0, p * 3 - i));
    px(g, 29, y, 10, 2, C.pink);
    px(g, 29, y, Math.round(local * 10), 2, C.crimson);
  });
  // The pen tip follows the bar being written.
  const row = Math.min(2, Math.floor(p * 3)), tip = 29 + Math.round(Math.min(1, p * 3 - row) * 10);
  px(g, tip, bars[row] - 2, 1, 2, C.ink); px(g, tip + 1, bars[row] - 3, 1, 1, C.ink);
  // Three discs, each a squat crimson drum with a dark rim.
  const glint = Math.floor(p * 3);
  for (let i = 0; i < 3; i++) {
    const y = 12 + i * 8;
    box(g, 46, y, 20, 9, C.crimson);
    px(g, 47, y + 6, 18, 2, C.deep);
    px(g, 49, y + 2, glint === 2 - i ? 4 : 2, 1, C.white);
  }
}

/** Step 3: the Pilot rides a rocket that lifts and settles, flame flickering, smoke puffing. */
function deploy(g: G, t: number) {
  field(g);
  const bob = Math.round(Math.sin(t * 2.4) * 1.5) - 1;
  const x = 30, y = 6 + bob;
  // Nose cone, body, porthole with the Pilot's face, fins.
  for (let r = 0; r < 6; r++) px(g, x + 6 - r, y + r, 2 + r * 2, 1, r === 0 ? C.ink : C.crimson);
  px(g, x, y + 6, 14, 1, C.ink);
  box(g, x, y + 6, 14, 20, C.white);
  box(g, x + 3, y + 9, 8, 8, C.ink);
  px(g, x + 4, y + 10, 6, 6, C.crimson); px(g, x + 4, y + 14, 6, 2, C.deep);
  const shut = blinking(t, 2.1);
  px(g, x + 5, y + (shut ? 12 : 11), 1, shut ? 1 : 2, C.white); px(g, x + 8, y + (shut ? 12 : 11), 1, shut ? 1 : 2, C.white);
  px(g, x - 4, y + 18, 4, 8, C.crimson); px(g, x - 4, y + 18, 1, 8, C.ink); px(g, x - 4, y + 25, 4, 1, C.ink);
  px(g, x + 14, y + 18, 4, 8, C.crimson); px(g, x + 17, y + 18, 1, 8, C.ink); px(g, x + 14, y + 25, 4, 1, C.ink);
  // Flame: two shapes, swapped about eight times a second.
  const tall = Math.floor(t * 8) % 2 === 0;
  px(g, x + 4, y + 26, 6, 2, C.crimson); px(g, x + 5, y + 28, 4, tall ? 3 : 2, C.pink); px(g, x + 6, y + 28 + (tall ? 3 : 2), 2, 1, C.pink);
  // Smoke puffs on the ground, each swelling and fading on its own beat.
  px(g, 14, 45, 44, 1, C.ink);
  [20, 34, 48].forEach((cx, i) => {
    const s = Math.round(2 + 2 * Math.abs(Math.sin(t * 2 + i * 1.1)));
    px(g, cx - s, 44 - s, s * 2 + 1, s, C.grey); px(g, cx - s + 1, 44 - s - 1, s * 2 - 1, 1, C.grey);
  });
}

/** Step 4: the Pilot, crowned, holds up a setup code; its squares fill one by one and the door opens wider. */
function admin(g: G, t: number) {
  field(g);
  const p = cycle(t, 3.4);
  const hop = Math.round(Math.abs(Math.sin(t * 3)) * 1);
  pilot(g, 6, 24, blinking(t, 0.6), 1);
  // A crown floating just above, bobbing.
  const cy = 17 - hop;
  px(g, 9, cy + 2, 10, 3, C.crimson); px(g, 9, cy, 2, 2, C.crimson); px(g, 13, cy - 1, 2, 3, C.crimson); px(g, 17, cy, 2, 2, C.crimson);
  px(g, 9, cy + 4, 10, 1, C.deep); px(g, 13, cy - 1, 2, 1, C.pink);
  // The code card: four squares, filled in turn.
  box(g, 24, 26, 18, 8, C.white);
  for (let i = 0; i < 4; i++) {
    px(g, 26 + i * 4, 28, 3, 4, C.ink);
    px(g, 27 + i * 4, 29, 1, 2, p * 5 > i + 1 ? C.crimson : C.white);
  }
  // The door frame and the door leaf, swinging a little wider as the code fills.
  box(g, 46, 8, 14, 32, C.crimson); px(g, 48, 10, 10, 28, C.white);
  const leaf = 6 + Math.round(Math.min(1, p * 1.2) * 5);
  px(g, 59, 8, leaf, 32, C.ink); px(g, 60, 9, leaf - 2, 30, C.crimson); px(g, 60 + leaf - 3, 9, 1, 30, C.deep);
  px(g, 60 + Math.floor(leaf / 2) - 1, 20, 3, 4, C.grey); px(g, 60 + Math.floor(leaf / 2), 24, 1, 1, C.grey);
}

/** The four scenes in step order, and the grid size every one is drawn at. */
export const SETUP_SCENES = [buffer, database, deploy, admin] as const;
export const SCENE_SIZE = { width: W, height: H } as const;
