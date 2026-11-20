/**
 * The homepage hero as pixel art: Alex's demo week drawn on a 192x80 grid that CSS scales up crisp. The same five
 * steps as the walkthrough play on one 14-second loop: the empty times blink, drafts land from the newsletter, each
 * is checked and a quote is matched to its source, the post that would fail turns red, and the cursor approves the
 * rest. Every frame is drawn whole from the time t, so the loop is seamless and any moment can be drawn on its own.
 */
import type { WeekModel } from "@/lib/week-model";

export const HERO_SIZE = { width: 192, height: 80 } as const;
export const HERO_LOOP = 14;
/** When each step starts, in seconds into the loop: empty times, drafts, checks, the failing post, approve. */
export const STEP_AT = [0, 1.6, 4.4, 7.2, 10] as const;

const W = HERO_SIZE.width, H = HERO_SIZE.height;
const C = {
  ink: "#1C1A1F", crimson: "#8F2457", deep: "#6E1A43", shine: "#B8507F", pink: "#F3D6E2", shadow: "#EED3DE",
  grey: "#E9E7EC", greyMid: "#D4D0D9", greyText: "#B9B4C0", white: "#FFFFFF",
  green: "#2E7D4F", greenWash: "#E3F3E8", red: "#C0392B", redWash: "#FBE4E1",
} as const;
const CHANNEL_COLOR: Record<string, string> = { linkedin: "#0A66C2", instagram: "#E1306C", threads: C.ink, x: C.ink };

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

type G = CanvasRenderingContext2D;
const px = (g: G, x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
function box(g: G, x: number, y: number, w: number, h: number, fill: string, edge: string = C.ink) {
  px(g, x + 1, y, w - 2, h, edge); px(g, x, y + 1, w, h - 2, edge);
  px(g, x + 1, y + 1, w - 2, h - 2, fill);
}

/** Where everything sits: one card per channel and weekday that has a posting time, in the demo's own order. */
/** The board's place on the canvas; the page uses it to draw the dot pattern right up to the board's edge. */
export const BOARD = { x: 4, y: 4, w: 184, h: 72 };
const COL0 = 34, COL_W = 30, ROW0 = 26, ROW_H = 12, CARD_W = 26, CARD_H = 9;
type Card = { x: number; y: number; status: "empty" | "scheduled" | "draft"; draftIndex: number; blocked: boolean; channel: string };

/** A time's card: its post's draft or scheduled state, or empty when nothing is planned there. */
function cardStatus(post: string | undefined): Card["status"] {
  if (post === undefined) return "empty";
  return post === "draft" ? "draft" : "scheduled";
}

/** Lays out Alex's Monday-to-Friday week as cards: scheduled posts, drafts (in the order they land) and empty times. */
export function layoutWeek(week: WeekModel): Card[] {
  const cards: Card[] = [];
  let d = 0;
  week.channels.forEach((ch, row) => {
    for (let day = 0; day < 5; day++) {
      const times = week.slots[ch.id]?.[day] ?? [];
      if (!times.length) continue;
      const post = week.posts.find((p) => p.channel === ch.id && p.day === day);
      const status = cardStatus(post?.status);
      cards.push({
        x: COL0 + day * COL_W + 2, y: ROW0 + row * ROW_H + 2, status, channel: ch.id,
        draftIndex: status === "draft" ? d++ : -1,
        blocked: status === "draft" && !!post?.checks?.some((c) => c.tone === "danger"),
      });
    }
  });
  return cards;
}

/** The pointer, in pixels: "o" white edge, "x" crimson fill. */
const POINTER = ["o", "oo", "oxo", "oxxo", "oxxxo", "oxxxxo", "oxxxxxo", "oxxxxoo", "oxoxxo", "oo.oxxo", "....oo"];
function pointer(g: G, x: number, y: number, down: boolean) {
  const fill = down ? C.deep : C.crimson;
  POINTER.forEach((row, r) => row.split("").forEach((c, k) => { if (c !== ".") px(g, x + k, y + r + (down ? 1 : 0), 1, 1, c === "o" ? C.white : fill); }));
}

function badge(g: G, x: number, y: number, good: boolean) {
  const c = good ? C.green : C.red;
  px(g, x + 1, y, 5, 7, c); px(g, x, y + 1, 7, 5, c);
  if (good) { px(g, x + 1, y + 3, 1, 1, C.white); px(g, x + 2, y + 4, 1, 1, C.white); px(g, x + 3, y + 3, 1, 1, C.white); px(g, x + 4, y + 2, 1, 1, C.white); px(g, x + 5, y + 1, 1, 1, C.white); }
  else { for (let i = 0; i < 4; i++) { px(g, x + 1.5 + i, y + 1.5 + i, 1, 1, C.white); px(g, x + 4.5 - i, y + 1.5 + i, 1, 1, C.white); } }
}

/** The moments of the loop, in seconds: when each draft lands, gets its check, and goes green after Approve. */
const landAt = (i: number) => 1.9 + i * 0.45;
const checkAt = (i: number) => 4.5 + i * 0.3;
const APPROVE_AT = 11.2;
const doneAt = (i: number) => APPROVE_AT + 0.25 + i * 0.15;
/** The newsletter page in the board's header, where every draft's line starts. */
const DOC = { x: 10, y: 7 };
const BUTTON = { x: 150, y: 8, w: 32, h: 9 };

/** Approve's colours: lit while drafts are waiting, darker while pressed, quiet once everything is scheduled. */
function buttonColours(waiting: boolean, pressed: boolean): { fill: string; edge: string; text: string } {
  if (!waiting) return { fill: C.grey, edge: C.greyMid, text: C.greyText };
  return { fill: pressed ? C.deep : C.crimson, edge: C.deep, text: C.white };
}

/** The board: a window with the newsletter in its header, an Approve button, day columns and channel rows. */
function drawBoard(g: G, waiting: boolean, pressed: boolean) {
  box(g, BOARD.x, BOARD.y, BOARD.w, BOARD.h, C.white);
  // The newsletter: a page with a folded corner and lines.
  box(g, DOC.x, DOC.y, 10, 12, C.white);
  px(g, DOC.x + 7, DOC.y + 1, 2, 2, C.pink); px(g, DOC.x + 2, DOC.y + 4, 6, 1, C.crimson); px(g, DOC.x + 2, DOC.y + 6, 5, 1, C.greyMid); px(g, DOC.x + 2, DOC.y + 8, 6, 1, C.greyMid);
  px(g, 24, 9, 46, 3, C.ink); px(g, 24, 14, 30, 2, C.greyText);
  const b = buttonColours(waiting, pressed);
  box(g, BUTTON.x, BUTTON.y, BUTTON.w, BUTTON.h, b.fill, b.edge);
  px(g, BUTTON.x + 7, BUTTON.y + 4, 18, 1, b.text);
  // Day columns and channel rows.
  for (let d = 0; d < 5; d++) px(g, COL0 + d * COL_W + 3, 21, 9, 2, C.greyText);
  for (let r = 0; r < 4; r++) {
    const y = ROW0 + r * ROW_H;
    px(g, BOARD.x + 1, y - 1, BOARD.w - 2, 1, C.grey);
    const ch = ["linkedin", "instagram", "threads", "x"][r];
    px(g, 9, y + 2, 7, 7, CHANNEL_COLOR[ch] ?? C.ink); px(g, 11, y + 4, 3, 3, C.white);
    px(g, 18, y + 4, 11, 2, C.greyText);
  }
}

/** A scheduled post: a grey card with a green dot and its lines. */
function drawScheduled(g: G, c: Card) {
  px(g, c.x, c.y, CARD_W, CARD_H, C.grey); px(g, c.x + 2, c.y + 2, 2, 2, C.green);
  px(g, c.x + 6, c.y + 2, 12, 2, C.greyText); px(g, c.x + 2, c.y + 5, 20, 1, C.greyMid); px(g, c.x + 2, c.y + 7, 16, 1, C.greyMid);
}

/** The newsletter's dotted line reaching a time just before its draft lands there. */
function drawSourceLine(g: G, c: Card, t: number) {
  const k = clamp((t - (landAt(c.draftIndex) - 0.45)) / 0.45);
  if (k <= 0) return;
  const sx = DOC.x + 9, sy = DOC.y + 11, ex = c.x + 3, ey = c.y + 2;
  for (let s = 0; s <= 1; s += 0.035) if (s <= k && Math.round(s * 100) % 7 < 4) px(g, sx + (ex - sx) * s, sy + (ey - sy) * s, 1, 1, C.crimson);
}

/** An empty time: a dashed outline that blinks crimson while the empty times are being pointed out. */
function drawEmpty(g: G, c: Card, t: number) {
  const lit = t < STEP_AT[1] && Math.floor(t * 3) % 2 === 0;
  const dash = lit ? C.crimson : C.greyMid;
  for (let k = 0; k < CARD_W; k += 3) { px(g, c.x + k, c.y, 2, 1, dash); px(g, c.x + k, c.y + CARD_H - 1, 2, 1, dash); }
  for (let k = 0; k < CARD_H; k += 3) { px(g, c.x, c.y + k, 1, 2, dash); px(g, c.x + CARD_W - 1, c.y + k, 1, 2, dash); }
  if (c.status === "draft") drawSourceLine(g, c, t);
}

/** A draft's colours: red once it fails, green once approved, crimson while it waits. */
function draftColours(failing: boolean, approved: boolean): { edge: string; fill: string } {
  if (failing) return { edge: C.red, fill: C.redWash };
  return approved ? { edge: C.green, fill: C.greenWash } : { edge: C.crimson, fill: C.white };
}

/** The failing draft's one shake: a pixel right, then left, twenty times a second. */
const shakeAt = (t: number) => (Math.floor(t * 20) % 2 ? 1 : -1);

/** A draft: it settles in, then shows its check; the failing one turns red and shakes once; approved ones go green. */
function drawDraft(g: G, c: Card, t: number) {
  const i = c.draftIndex;
  const settle = clamp((t - landAt(i)) / 0.3), drop = Math.round((1 - settle) * 3);
  const failing = c.blocked && t >= STEP_AT[3];
  const approved = !c.blocked && t >= doneAt(i);
  const shake = failing && t < STEP_AT[3] + 0.6 ? shakeAt(t) : 0;
  const x = c.x + shake, y = c.y - drop;
  const { edge, fill } = draftColours(failing, approved);
  px(g, x, y, CARD_W, CARD_H, edge); px(g, x + 1, y + 1, CARD_W - 2, CARD_H - 2, fill);
  px(g, x + 1, y + 1, 2, CARD_H - 2, edge);
  px(g, x + 5, y + 2, 14, 2, edge);
  px(g, x + 5, y + 6, 17, 1, C.greyMid);
  if (t >= checkAt(i)) badge(g, x + CARD_W - 5, y - 3, !c.blocked);
}

/** One card at time t: scheduled, an empty time (or a draft not landed yet), or a landed draft. */
function drawCard(g: G, c: Card, t: number) {
  if (c.status === "scheduled") return drawScheduled(g, c);
  const landed = c.status === "draft" && t >= landAt(c.draftIndex);
  if (landed) drawDraft(g, c, t);
  else drawEmpty(g, c, t);
}

/** Step five: the pointer comes in from the corner, settles on Approve, presses. */
function drawApprovePointer(g: G, t: number, pressed: boolean) {
  if (t < STEP_AT[4] || t >= HERO_LOOP - 1.5) return;
  const k = clamp((t - STEP_AT[4] - 0.1) / 0.9), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
  const fx = 176, fy = H, tx = BUTTON.x + 20, ty = BUTTON.y + 5;
  pointer(g, fx + (tx - fx) * e, fy + (ty - fy) * e - Math.sin(k * Math.PI) * 6, pressed);
}

/** Draws the whole hero for time t (seconds); t wraps at the loop length. */
export function drawHero(g: G, cards: Card[], time: number) {
  const t = time % HERO_LOOP;
  const drafts = cards.filter((c) => c.status === "draft").length;
  // No field of its own: around the board the canvas stays clear, so the page's dot pattern runs on behind it.
  g.clearRect(0, 0, W, H);
  const waiting = t >= landAt(0) && t < doneAt(drafts - 1);
  const pressed = t >= APPROVE_AT - 0.15 && t < APPROVE_AT + 0.15;
  drawBoard(g, waiting, pressed);
  for (const c of cards) drawCard(g, c, t);
  drawApprovePointer(g, t, pressed);
}

/** When the quote panel is open, in seconds into the loop. The page blurs the board behind it while it is. */
export const QUOTE_AT = [5.8, 7.2] as const;

/** The first draft that passes, while the quote panel is open on it at this time; null when the panel is closed. */
function quoteCard(cards: Card[], time: number): Card | null {
  const t = time % HERO_LOOP;
  // Step three: the quote check, shown on the first draft: the line in the draft beside the line in the source.
  const first = cards.filter((c) => c.status === "draft").sort((a, b) => a.draftIndex - b.draftIndex).find((d) => !d.blocked);
  if (!first || t < QUOTE_AT[0] || t >= QUOTE_AT[1]) return null;
  return first;
}

/**
 * Whether the quote panel shows at this time, without drawing it: the page blurs the board behind it while it does.
 *
 * @param cards - The laid-out week
 * @param time - Seconds into the scene
 * @returns True while the panel is open
 */
export function quoteShowing(cards: Card[], time: number): boolean {
  return quoteCard(cards, time) !== null;
}

/**
 * Draws the quote check panel on its own layer, so the board underneath can be blurred like a page behind a modal.
 * Clears the layer first; returns whether the panel is showing at this moment.
 */
export function drawQuote(g: G, cards: Card[], time: number) {
  const t = time % HERO_LOOP;
  g.clearRect(0, 0, W, H);
  const first = quoteCard(cards, time);
  if (!first) return false;
  {
    const k = clamp((t - QUOTE_AT[0]) / 0.25), pw = 70, ph = 30;
    const x = Math.min(first.x + 4, BOARD.x + BOARD.w - pw - 4), y = first.y + CARD_H + 2 - Math.round((1 - k) * 3);
    px(g, x + 2, y + ph, pw - 4, 2, C.shadow);
    box(g, x, y, pw, ph, C.white);
    // A quote mark, then the draft's line and the source's line, highlighted the same, joined by an equals sign.
    px(g, x + 4, y + 4, 3, 3, C.crimson); px(g, x + 6, y + 7, 1, 2, C.crimson); px(g, x + 9, y + 4, 3, 3, C.crimson); px(g, x + 11, y + 7, 1, 2, C.crimson);
    px(g, x + 16, y + 5, 30, 4, C.pink); px(g, x + 18, y + 6, 24, 2, C.crimson);
    px(g, x + 49, y + 7, 5, 1, C.ink); px(g, x + 49, y + 10, 5, 1, C.ink);
    box(g, x + 4, y + 15, 8, 10, C.white); px(g, x + 6, y + 18, 4, 1, C.crimson); px(g, x + 6, y + 20, 3, 1, C.greyMid);
    px(g, x + 16, y + 18, 30, 4, C.pink); px(g, x + 18, y + 19, 24, 2, C.crimson);
    badge(g, x + 58, y + 11, true);
  }
  return true;
}

/** Where each step's popover points, in canvas pixels, and whether it opens above or below that point. */
export type StepAnchor = { x: number; y: number; place: "above" | "below" };

/**
 * The part of the board each step is about: an empty time, the drafts landing, a passed check, the post that is held
 * back, and the Approve button. The popover sits beside it so the words and the picture are read together.
 */
export function stepAnchor(cards: Card[], step: number): StepAnchor {
  const drafts = cards.filter((c) => c.status === "draft").sort((a, b) => a.draftIndex - b.draftIndex);
  const first = drafts.find((d) => !d.blocked) ?? drafts[0];
  const blocked = drafts.find((d) => d.blocked) ?? first;
  const last = drafts[drafts.length - 1] ?? first;
  if (!first) return { x: W / 2, y: H / 2, place: "below" };
  switch (step) {
    case 0: return { x: first.x + CARD_W / 2, y: first.y + CARD_H, place: "below" };
    case 1: return { x: last.x + CARD_W / 2, y: last.y, place: "above" };
    // Above the first draft's tick, since the quote panel opens below it.
    case 2: return { x: first.x + CARD_W - 2, y: first.y - 3, place: "above" };
    case 3: return { x: blocked.x + CARD_W - 2, y: blocked.y - 3, place: "above" };
    default: return { x: 166, y: 19, place: "below" };
  }
}
