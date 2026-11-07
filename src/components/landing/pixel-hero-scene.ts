/**
 * The homepage hero as pixel art: Alex's demo week drawn on a 192x96 grid that CSS scales up crisp. The same five
 * steps as the walkthrough play on one 20-second loop: the empty times blink, drafts land from the newsletter, each
 * is checked and a quote is matched to its source, the post that would fail turns red, and the cursor approves the
 * rest. Every frame is drawn whole from the time t, so the loop is seamless and any moment can be drawn on its own.
 */
import type { WeekModel } from "@/lib/week-model";

export const HERO_SIZE = { width: 192, height: 96 } as const;
export const HERO_LOOP = 20;
/** When each step starts, in seconds into the loop: empty times, drafts, checks, the failing post, approve. */
export const STEP_AT = [0, 2.2, 6, 10, 13] as const;

const W = HERO_SIZE.width, H = HERO_SIZE.height;
const C = {
  ink: "#1C1A1F", crimson: "#8F2457", deep: "#6E1A43", shine: "#B8507F", pink: "#F3D6E2", dot: "#F7E1EA", shadow: "#EED3DE",
  grey: "#E9E7EC", greyMid: "#D4D0D9", greyText: "#B9B4C0", white: "#FFFFFF",
  green: "#2E7D4F", greenWash: "#E3F3E8", red: "#C0392B", redWash: "#FBE4E1",
} as const;
const CHANNEL_COLOR: Record<string, string> = { linkedin: "#0A66C2", instagram: "#E1306C", threads: C.ink, x: C.ink };

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const threshold = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];
const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

type G = CanvasRenderingContext2D;
const px = (g: G, x: number, y: number, w: number, h: number, c: string) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); };
function box(g: G, x: number, y: number, w: number, h: number, fill: string, edge: string = C.ink) {
  px(g, x + 1, y, w - 2, h, edge); px(g, x, y + 1, w, h - 2, edge);
  px(g, x + 1, y + 1, w - 2, h - 2, fill);
}

/** Where everything sits: one card per channel and weekday that has a posting time, in the demo's own order. */
const BOARD = { x: 4, y: 5, w: 184, h: 86 };
const COL0 = 34, COL_W = 30, ROW0 = 29, ROW_H = 15, CARD_W = 26, CARD_H = 11;
type Card = { x: number; y: number; status: "empty" | "scheduled" | "draft"; draftIndex: number; blocked: boolean; channel: string };

/** Lays out Alex's Monday-to-Friday week as cards: scheduled posts, drafts (in the order they land) and empty times. */
export function layoutWeek(week: WeekModel): Card[] {
  const cards: Card[] = [];
  let d = 0;
  week.channels.forEach((ch, row) => {
    for (let day = 0; day < 5; day++) {
      const times = week.slots[ch.id]?.[day] ?? [];
      if (!times.length) continue;
      const post = week.posts.find((p) => p.channel === ch.id && p.day === day);
      const status = post?.status === "draft" ? "draft" : post ? "scheduled" : "empty";
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
  POINTER.forEach((row, r) => [...row].forEach((c, k) => { if (c !== ".") px(g, x + k, y + r + (down ? 1 : 0), 1, 1, c === "o" ? C.white : down ? C.deep : C.crimson); }));
}

function badge(g: G, x: number, y: number, good: boolean) {
  const c = good ? C.green : C.red;
  px(g, x + 1, y, 5, 7, c); px(g, x, y + 1, 7, 5, c);
  if (good) { px(g, x + 1, y + 3, 1, 1, C.white); px(g, x + 2, y + 4, 1, 1, C.white); px(g, x + 3, y + 3, 1, 1, C.white); px(g, x + 4, y + 2, 1, 1, C.white); px(g, x + 5, y + 1, 1, 1, C.white); }
  else { for (let i = 0; i < 4; i++) { px(g, x + 1.5 + i, y + 1.5 + i, 1, 1, C.white); px(g, x + 4.5 - i, y + 1.5 + i, 1, 1, C.white); } }
}

/** Draws the whole hero for time t (seconds); t wraps at the loop length. */
export function drawHero(g: G, cards: Card[], time: number) {
  const t = time % HERO_LOOP;
  const drafts = cards.filter((c) => c.status === "draft").sort((a, b) => a.draftIndex - b.draftIndex);
  const landAt = (i: number) => 2.6 + i * 0.6;
  const checkAt = (i: number) => 6.3 + i * 0.45;
  const approveAt = 14.4;
  const doneAt = (i: number) => approveAt + 0.3 + i * 0.25;

  // The field: denser toward the right, like the homepage.
  px(g, 0, 0, W, H, C.white);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = clamp((x / W - 0.55) / 0.45) * 0.5;
    if (d > threshold(x, y)) px(g, x, y, 1, 1, C.dot);
  }

  // The board: a window with the newsletter in its header, an Approve button, day columns and channel rows.
  px(g, BOARD.x + 2, BOARD.y + BOARD.h, BOARD.w - 4, 2, C.shadow);
  box(g, BOARD.x, BOARD.y, BOARD.w, BOARD.h, C.white);
  // The newsletter: a page with a folded corner and lines.
  const docX = 10, docY = 9;
  box(g, docX, docY, 10, 12, C.white);
  px(g, docX + 7, docY + 1, 2, 2, C.pink); px(g, docX + 2, docY + 4, 6, 1, C.crimson); px(g, docX + 2, docY + 6, 5, 1, C.greyMid); px(g, docX + 2, docY + 8, 6, 1, C.greyMid);
  px(g, 24, 11, 46, 3, C.ink); px(g, 24, 16, 30, 2, C.greyText);
  // Approve: lit while drafts are waiting, pressed at its moment, quiet once everything is scheduled.
  const btn = { x: 150, y: 10, w: 32, h: 9 };
  const anyWaiting = t >= landAt(0) && t < doneAt(drafts.length - 1);
  const pressed = t >= approveAt - 0.15 && t < approveAt + 0.15;
  box(g, btn.x, btn.y, btn.w, btn.h, anyWaiting ? (pressed ? C.deep : C.crimson) : C.grey, anyWaiting ? C.deep : C.greyMid);
  px(g, btn.x + 7, btn.y + 4, 18, 1, anyWaiting ? C.white : C.greyText);
  // Day columns and channel rows.
  for (let d = 0; d < 5; d++) px(g, COL0 + d * COL_W + 3, 24, 9, 2, C.greyText);
  for (let r = 0; r < 4; r++) {
    const y = ROW0 + r * ROW_H;
    px(g, BOARD.x + 1, y - 1, BOARD.w - 2, 1, C.grey);
    const ch = ["linkedin", "instagram", "threads", "x"][r];
    px(g, 9, y + 4, 7, 7, CHANNEL_COLOR[ch] ?? C.ink); px(g, 11, y + 6, 3, 3, C.white);
    px(g, 18, y + 6, 11, 2, C.greyText);
  }

  // Cards.
  for (const c of cards) {
    const i = c.draftIndex;
    if (c.status === "scheduled") {
      px(g, c.x, c.y, CARD_W, CARD_H, C.grey); px(g, c.x + 2, c.y + 2, 2, 2, C.green);
      px(g, c.x + 6, c.y + 2, 12, 2, C.greyText); px(g, c.x + 2, c.y + 6, 20, 1, C.greyMid); px(g, c.x + 2, c.y + 8, 16, 1, C.greyMid);
      continue;
    }
    const landed = c.status === "draft" && t >= landAt(i);
    if (!landed) {
      // An empty time: a dashed outline that blinks crimson while the empty times are being pointed out.
      const lit = t < STEP_AT[1] && Math.floor(t * 3) % 2 === 0;
      for (let k = 0; k < CARD_W; k += 3) { px(g, c.x + k, c.y, 2, 1, lit ? C.crimson : C.greyMid); px(g, c.x + k, c.y + CARD_H - 1, 2, 1, lit ? C.crimson : C.greyMid); }
      for (let k = 0; k < CARD_H; k += 3) { px(g, c.x, c.y + k, 1, 2, lit ? C.crimson : C.greyMid); px(g, c.x + CARD_W - 1, c.y + k, 1, 2, lit ? C.crimson : C.greyMid); }
      // The newsletter's line reaching this time just before its draft lands.
      if (c.status === "draft") {
        const k = clamp((t - (landAt(i) - 0.45)) / 0.45);
        if (k > 0) {
          const sx = docX + 9, sy = docY + 11, ex = c.x + 3, ey = c.y + 2;
          for (let s = 0; s <= 1; s += 0.035) if (s <= k && Math.round(s * 100) % 7 < 4) px(g, sx + (ex - sx) * s, sy + (ey - sy) * s, 1, 1, C.crimson);
        }
      }
      continue;
    }
    // A draft: it settles in, then shows its check; the failing one turns red and shakes once; approved ones go green.
    const settle = clamp((t - landAt(i)) / 0.3), drop = Math.round((1 - settle) * 3);
    const failing = c.blocked && t >= STEP_AT[3];
    const approved = !c.blocked && t >= doneAt(i);
    const shake = failing && t < STEP_AT[3] + 0.6 ? (Math.floor(t * 20) % 2 ? 1 : -1) : 0;
    const x = c.x + shake, y = c.y - drop;
    const edge = failing ? C.red : approved ? C.green : C.crimson;
    const fill = failing ? C.redWash : approved ? C.greenWash : C.white;
    px(g, x, y, CARD_W, CARD_H, edge); px(g, x + 1, y + 1, CARD_W - 2, CARD_H - 2, fill);
    px(g, x + 1, y + 1, 2, CARD_H - 2, edge);
    px(g, x + 5, y + 3, 14, 2, failing ? C.red : approved ? C.green : C.crimson);
    px(g, x + 5, y + 7, 17, 1, C.greyMid);
    if (t >= checkAt(i)) badge(g, x + CARD_W - 5, y - 3, !c.blocked);
  }

  // Step three: the quote check, shown on the first draft: the line in the draft beside the line in the source.
  const first = drafts.find((d) => !d.blocked);
  if (first && t >= 8 && t < 10) {
    const k = clamp((t - 8) / 0.25), pw = 70, ph = 30;
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

  // Step five: the pointer comes in from the corner, settles on Approve, presses.
  if (t >= STEP_AT[4] && t < HERO_LOOP - 1.5) {
    const k = clamp((t - STEP_AT[4] - 0.2) / 0.9), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    const fx = 176, fy = 96, tx = btn.x + 20, ty = btn.y + 5;
    pointer(g, fx + (tx - fx) * e, fy + (ty - fy) * e - Math.sin(k * Math.PI) * 6, pressed);
  }
}
