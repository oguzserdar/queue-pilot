/**
 * The four "Run your own copy" steps drawn as pixel art, one scene per step, on a 72x48 grid that CSS scales up
 * with crisp edges. Each draw call paints the whole scene for time t (seconds): the dithered field, the Pilot with
 * its shadow, and the step's object with its motion. Every loop ends on a small success beat (sparkle, hop), then
 * starts over. Same palette and Pilot as the homepage.
 */
const W = 72, H = 48;
const C = {
  ink: "#1C1A1F", crimson: "#8F2457", deep: "#6E1A43", shine: "#B8507F", pink: "#F3D6E2", dot: "#F7E1EA",
  shadow: "#EED3DE", grey: "#E9E7EC", greyDark: "#C9C5CF", white: "#FFFFFF", glow: "#FFF3F7",
} as const;

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const threshold = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

type G = CanvasRenderingContext2D;
const px = (g: G, x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
/** A filled box with a one-pixel ink outline and cut corners. */
function box(g: G, x: number, y: number, w: number, h: number, fill: string) {
  px(g, x + 1, y, w - 2, h, C.ink); px(g, x, y + 1, w, h - 2, C.ink);
  px(g, x + 1, y + 1, w - 2, h - 2, fill);
}
/** A flat pixel ellipse, used for shadows, discs and smoke. */
function oval(g: G, cx: number, cy: number, rx: number, ry: number, c: string) {
  for (let y = -ry; y <= ry; y++) {
    const half = Math.round(rx * Math.sqrt(Math.max(0, 1 - (y / (ry + 0.5)) ** 2)));
    if (half > 0) px(g, cx - half, cy + y, half * 2, 1, c);
  }
}
/** A four-point sparkle, size 1 (a plus) or 2 (a plus with longer arms). */
function sparkle(g: G, x: number, y: number, size: 1 | 2, c: string = C.crimson) {
  px(g, x, y - size, 1, size * 2 + 1, c); px(g, x - size, y, size * 2 + 1, 1, c);
  if (size === 2) px(g, x, y, 1, 1, C.white);
}
/** Eyes closed for about a sixth of a second every few seconds, offset per scene. */
const blinking = (t: number, offset: number) => ((t + offset) % 3.8) < 0.17;
const phase = (t: number, length: number) => (t % length) / length;
/** A quick hop at the start of a beat: up two pixels and back, over the first fifth of it. */
const hop = (p: number, at: number) => { const k = (p - at) / 0.08; return k > 0 && k < 1 ? -Math.round(Math.sin(k * Math.PI) * 2) : 0; };

/** The pink field: denser toward the right and the middle, like the homepage hero, so the left stays calm. */
function field(g: G) {
  px(g, 0, 0, W, H, C.white);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = clamp((x / W - 0.3) / 0.7) * (0.35 + 0.65 * Math.sin((y / H) * Math.PI)) * 0.55;
    if (d > threshold(x, y)) px(g, x, y, 1, 1, C.dot);
  }
}

/** The Pilot, 16x16, with a soft shadow on the ground: crimson body, darker belly, a shine, two tall white eyes. */
function pilot(g: G, x: number, y: number, closed: boolean, look = 0, lift = 0) {
  oval(g, x + 8, y + 17, 7 - Math.abs(lift), 1, C.shadow);
  y += lift;
  for (let r = 0; r < 16; r++) {
    const inset = r === 0 || r === 15 ? 3 : r === 1 || r === 14 ? 1 : 0;
    px(g, x + inset, y + r, 16 - inset * 2, 1, C.ink);
  }
  for (let r = 1; r < 15; r++) {
    const inset = r === 1 || r === 14 ? 3 : r === 2 || r === 13 ? 2 : 1;
    px(g, x + inset, y + r, 16 - inset * 2, 1, r >= 11 ? C.deep : C.crimson);
  }
  px(g, x + 3, y + 3, 2, 1, C.shine); px(g, x + 2, y + 4, 1, 2, C.shine);
  const ex = x + 4 + look;
  if (closed) { px(g, ex, y + 7, 2, 1, C.white); px(g, ex + 6, y + 7, 2, 1, C.white); }
  else { px(g, ex, y + 5, 2, 5, C.white); px(g, ex + 6, y + 5, 2, 5, C.white); }
}

/** Step 1, Buffer app client: the Pilot pushes a key into an app window and turns it; the window lights, the redirect arrow runs back. */
function buffer(g: G, t: number) {
  field(g);
  const p = phase(t, 3.6);
  const slide = Math.round(clamp(p / 0.3) * 6), turned = p > 0.36, open = p > 0.42 && p < 0.95;
  const lift = hop(p, 0.42);
  pilot(g, 3 + slide, 19, blinking(t, 0), 1, lift);
  // The app window: title bar with three dots, a keyhole plate, and a light wash once it opens.
  box(g, 38, 11, 22, 22, open ? C.glow : C.white);
  px(g, 39, 12, 20, 4, open ? C.crimson : C.grey);
  [41, 44, 47].forEach((dx) => px(g, dx, 13, 2, 2, open ? C.pink : C.greyDark));
  px(g, 46, 20, 6, 8, C.grey); px(g, 48, 22, 2, 2, C.deep); px(g, 48, 24, 2, 2, C.deep);
  // The key: a ring bow, a shaft into the keyhole, two teeth that flip upright when it turns.
  const kx = 19 + slide, ky = 24;
  px(g, kx, ky - 3, 6, 7, C.ink); px(g, kx + 1, ky - 2, 4, 5, C.crimson); px(g, kx + 2, ky - 1, 2, 3, C.white);
  px(g, kx + 6, ky, 48 - kx - 6, 1, C.ink);
  if (turned) { px(g, 44, ky - 2, 1, 2, C.ink); px(g, 42, ky - 2, 1, 2, C.ink); }
  else { px(g, kx + 15, ky + 1, 1, 2, C.ink); px(g, kx + 17, ky + 1, 1, 2, C.ink); }
  // The redirect: a hook out of the window's right side and back in, its light running along it while open.
  const hook: [number, number][] = [];
  for (let x = 60; x <= 65; x++) hook.push([x, 18]);
  for (let y = 19; y <= 30; y++) hook.push([65, y]);
  for (let x = 64; x >= 61; x--) hook.push([x, 30]);
  hook.forEach(([x, y], i) => px(g, x, y, 1, 1, open && Math.abs(i - ((t * 24) % hook.length)) < 3 ? C.crimson : C.deep));
  px(g, 60, 29, 1, 3, C.deep); px(g, 59, 30, 1, 1, C.deep);
  if (open && p < 0.7) { sparkle(g, 36, 9, 2); sparkle(g, 62, 9, 1); }
}

/** Step 2, database and settings: the Pilot writes the settings card line by line beside a stack of database discs; each finished line lights a disc. */
function database(g: G, t: number) {
  field(g);
  const p = phase(t, 4.2);
  const done = p > 0.8;
  pilot(g, 3, 23, blinking(t, 1.3), 1, hop(p, 0.8));
  // The settings card with three lines; the line being written fills left to right.
  box(g, 24, 13, 17, 24, C.white);
  px(g, 26, 15, 6, 2, C.grey);
  const lines = [20, 25, 30];
  lines.forEach((y, i) => {
    const fill = clamp(p / 0.25 - i);
    px(g, 27, y, 11, 2, C.pink);
    px(g, 27, y, Math.round(fill * 11), 2, C.crimson);
  });
  // The pen, held at the tip of the line being written.
  const row = Math.min(2, Math.floor(p / 0.25)), tipX = 27 + Math.round(clamp(p / 0.25 - row) * 11), tipY = lines[row];
  if (!done) { px(g, tipX, tipY - 1, 1, 1, C.ink); px(g, tipX + 1, tipY - 2, 1, 1, C.ink); px(g, tipX + 2, tipY - 3, 2, 1, C.crimson); px(g, tipX + 3, tipY - 4, 2, 1, C.crimson); }
  // Three discs, bottom to top; a disc lights once its line is written.
  for (let i = 2; i >= 0; i--) {
    const y = 14 + i * 9, lit = clamp(p / 0.25 - (2 - i)) >= 1;
    px(g, 45, y + 3, 22, 7, C.ink); px(g, 46, y + 3, 20, 6, lit ? C.crimson : C.deep);
    oval(g, 56, y + 3, 11, 3, C.ink); oval(g, 56, y + 3, 10, 2, lit ? C.shine : C.crimson);
    px(g, 46, y + 8, 20, 1, C.deep);
    if (lit) px(g, 49, y + 5, 3, 1, C.white);
  }
  if (done) { sparkle(g, 68, 10, 2); sparkle(g, 43, 9, 1); }
}

/** Step 3, deploy: the Pilot in a rocket's window; the rocket settles, rises a little, flame flickering, smoke rolling out, then a sparkle at the top. */
function deploy(g: G, t: number) {
  field(g);
  const p = phase(t, 3.2);
  const rise = Math.round(Math.sin(p * Math.PI * 2) * 2) - 1;
  const x = 29, y = 6 + rise;
  // Shadow on the ground, smaller as the rocket rises.
  oval(g, x + 7, 43, 9 + rise, 1, C.shadow);
  // Nose cone, body with a rivet line, the window with the Pilot's face, fins.
  for (let r = 0; r < 6; r++) px(g, x + 6 - r, y + r, 2 + r * 2, 1, r === 0 ? C.ink : C.crimson);
  px(g, x + 6, y + 1, 1, 3, C.shine);
  box(g, x, y + 6, 14, 20, C.white);
  px(g, x, y + 6, 14, 1, C.ink); px(g, x + 1, y + 21, 12, 1, C.grey);
  box(g, x + 3, y + 9, 8, 8, C.ink);
  px(g, x + 4, y + 10, 6, 6, C.crimson); px(g, x + 4, y + 14, 6, 2, C.deep);
  const shut = blinking(t, 2.1);
  px(g, x + 5, y + (shut ? 12 : 11), 1, shut ? 1 : 2, C.white); px(g, x + 8, y + (shut ? 12 : 11), 1, shut ? 1 : 2, C.white);
  for (const [fx, dir] of [[x - 4, 1], [x + 14, -1]] as const) {
    px(g, fx, y + 18, 4, 8, C.ink); px(g, fx + (dir === 1 ? 1 : 0), y + 19, 3, 6, C.crimson);
  }
  // Flame: three shapes in turn.
  const f = Math.floor(t * 10) % 3;
  px(g, x + 4, y + 26, 6, 2, C.ink);
  px(g, x + 4, y + 28, 6, 2, C.crimson);
  px(g, x + 5, y + 30, 4, 1 + f, C.pink);
  px(g, x + 6, y + 31 + f, 2, 1, C.pink);
  // Smoke: round puffs rolling outward from the base and fading.
  px(g, 12, 45, 48, 1, C.ink);
  for (let i = 0; i < 4; i++) {
    const k = (t * 0.7 + i / 4) % 1, side = i % 2 ? 1 : -1, r = Math.round(1 + k * 3);
    const cx = x + 7 + side * Math.round(4 + k * 14);
    oval(g, cx, 44 - r, r + 1, r, k > 0.75 ? C.grey : C.greyDark);
  }
  if (p > 0.2 && p < 0.45) { sparkle(g, x + 20, y + 2, 2); sparkle(g, x - 6, y + 8, 1); }
}

/** Step 4, admin: the crowned Pilot holds up a setup code; the squares fill one by one, the door swings open and light falls out. */
function admin(g: G, t: number) {
  field(g);
  const p = phase(t, 4);
  const filled = Math.min(4, Math.floor(p / 0.15)), open = clamp((p - 0.6) / 0.15);
  const lift = hop(p, 0.6);
  pilot(g, 4, 24, blinking(t, 0.6), 1, lift);
  // The crown, bobbing just above.
  const cy = 17 + lift - (Math.floor(t * 2) % 2);
  px(g, 7, cy + 2, 10, 3, C.ink); px(g, 8, cy + 2, 8, 2, C.crimson);
  for (const dx of [7, 11, 15]) { px(g, dx, cy - 1, 2, 3, C.ink); px(g, dx, cy, 2, 2, C.crimson); }
  px(g, 11, cy, 2, 1, C.pink);
  // The code card: four squares, filled in turn.
  box(g, 22, 26, 19, 9, C.white);
  for (let i = 0; i < 4; i++) {
    px(g, 24 + i * 4, 28, 3, 5, C.ink);
    px(g, 25 + i * 4, 29, 1, 3, i < filled ? C.crimson : C.white);
  }
  // The doorway: light falls out across the floor once it opens.
  box(g, 46, 7, 14, 34, C.crimson);
  px(g, 48, 9, 10, 31, open > 0 ? C.glow : C.white);
  if (open > 0) for (let i = 0; i < 6; i++) px(g, 40 - i * 2, 40 - (i >> 1), 18 - i, 1, C.dot);
  // The door leaf swings out from closed (flush) to wide open.
  const leaf = Math.round(10 - open * 7);
  px(g, 48, 9, leaf, 31, C.ink); px(g, 49, 10, Math.max(1, leaf - 2), 29, C.crimson);
  if (leaf > 5) { px(g, 48 + leaf - 3, 24, 1, 2, C.pink); }
  // A shield on the frame above the door.
  px(g, 51, 3, 4, 3, C.ink); px(g, 52, 4, 2, 1, C.grey); px(g, 52, 6, 2, 1, C.ink);
  if (open >= 1 && p < 0.92) { sparkle(g, 64, 12, 2); sparkle(g, 42, 18, 1); }
}

/** The four scenes in step order, and the grid size every one is drawn at. */
export const SETUP_SCENES = [buffer, database, deploy, admin] as const;
export const SCENE_SIZE = { width: W, height: H } as const;
