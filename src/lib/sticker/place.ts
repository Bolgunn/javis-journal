// Where a sticker lands, how big it may be, and every clamp the sticker layer's gestures need
// (M7). The sticker analogue of `day/place.ts` — same shape, different box. Pure math: no React,
// no Dexie, no DOM.
//
// The coordinate model (M7 decision 1, load-bearing):
//   - Stickers are normalized to the **day-grid bounding box** — the `7·cellW × 6·cellH` rect
//     that already exists IDENTICALLY in both calendar views. It is the only rect that survives
//     a close-up ↔ full-month switch, and it is the rect M9's PNG export rasterizes.
//   - Its aspect therefore FALLS OUT of the cell's and is never hardcoded:
//     (7·cellW) / (6·cellH) = (7/6)·CELL_ASPECT = 28/15 at 8:5. (At the old 7:6 cell this
//     happened to equal CELL_ASPECT² = 49/36 — a coincidence of 7 columns × 6 rows, not a rule.)
//   - `pos_x`/`pos_y` ∈ [0,1] are the sticker's CENTER, as fractions of the grid's width and
//     height — the same center-based semantics as a stamp.
//   - `scale` is the sticker's WIDTH as a fraction of the GRID's width (so DEFAULT_SCALE = 1/7
//     is exactly one day cell wide). Its height follows from the image's own aspect.
//   - Internally we work in grid-width units (u): the grid is 1 wide and 1/GRID_ASPECT tall, so
//     both axes share one unit and rotation is honest.
//
// EVERY tunable number lives in STICKER (mirroring PLACEMENT). Retuning the feel is a one-object
// edit — the tests assert invariants (inside the grid, cascades, the 50-cap), never the numbers.

import { CELL_ASPECT_RATIO } from "@/lib/calendar/fit";
import type { PlacedSticker, RotationDeg } from "@/lib/db/types";
import type { Point } from "@/lib/gestures/machine";
import { live, maxLayer } from "@/lib/gestures/layers";

export type { Point };

/** The day-grid bbox's aspect (width / height) — DERIVED from the cell's, never re-invented. */
export const GRID_ASPECT = (7 / 6) * CELL_ASPECT_RATIO; // 7 columns × 6 rows of cells = 28/15

export const STICKER = {
  /** A new sticker enters about one day cell wide (1 of the grid's 7 columns). */
  DEFAULT_SCALE: 1 / 7,
  /** It can never be pinched smaller than this fraction of the grid's width. */
  MIN_SCALE: 0.05,
  /**
   * …nor bigger than this (~2 day cells). This is what BOUNDS the softness of rendering the
   * layer from 256px thumbs (decision 15) — the guardrail, not a taste call.
   */
  MAX_SCALE: 0.3,
  /** Repeat taps of the same tray sticker cascade diagonally by this (grid-width units). */
  CASCADE: 0.06,
  /** How many cascade steps to try before giving up and stacking (the chain is finite). */
  CASCADE_STEPS: 12,
  /** A month holds at most this many live stickers — a sanity cap, enforced in mutations.ts. */
  MAX_PER_MONTH: 50,
  /** Rotation is snapped to multiples of this on gesture-end (8 legal values). */
  SNAP_DEG: 45,
} as const;

/** Center + size of a sticker, normalized to the grid (`pos_*` / `scale` semantics). */
export type StickerPlacement = {
  pos_x: number;
  pos_y: number;
  scale: number;
  rotation_deg: RotationDeg;
  layer_order: number;
};

const clamp = (v: number, lo: number, hi: number): number =>
  lo > hi ? (lo + hi) / 2 : v < lo ? lo : v > hi ? hi : v;

/** The grid in grid-width units: 1 wide, this tall (15/28). */
const GRID_H_U = 1 / GRID_ASPECT;

/** Normalized (pos_x, pos_y) → grid-width units. */
export function toUnits(p: Point): Point {
  return { x: p.x, y: p.y * GRID_H_U };
}

/** Grid-width units → normalized (pos_x, pos_y). */
export function fromUnits(p: Point): Point {
  return { x: p.x, y: p.y / GRID_H_U };
}

/**
 * Half-extents (grid-width units) of the AXIS-ALIGNED BOUNDING BOX of a sticker of the given
 * scale/aspect rotated by `rotationDeg`. Every clamp below is an AABB test against the grid,
 * which is exactly the "a sticker never overhangs the grid" invariant — and that invariant is
 * load-bearing: M9's export rasterizes the grid rect, so an overhanging sticker would be clipped
 * in the export but not on screen (the preview≠export drift ADR-M5 exists to kill).
 */
export function halfExtents(
  scale: number,
  aspect: number,
  rotationDeg: number,
): { hx: number; hy: number } {
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const w = scale; // width in grid-width units
  const h = scale / aspect; // height in grid-width units
  return { hx: (w * c + h * s) / 2, hy: (w * s + h * c) / 2 };
}

/** The largest `scale` whose rotated box still fits inside the grid. */
export function maxFitScale(aspect: number, rotationDeg = 0): number {
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const byW = 1 / (c + s / aspect);
  const byH = GRID_H_U / (s + c / aspect);
  return Math.min(byW, byH);
}

/**
 * Clamp a scale into `[MIN_SCALE, min(MAX_SCALE, fits-in-the-grid)]`. MAX_SCALE is the sharpness
 * guardrail; the fit term is what stops a tall sticker rotated 90° from poking out of the grid.
 */
export function clampScale(scale: number, aspect: number, rotationDeg = 0): number {
  const max = Math.min(STICKER.MAX_SCALE, maxFitScale(aspect, rotationDeg));
  return clamp(scale, Math.min(STICKER.MIN_SCALE, max), max);
}

/**
 * Pull a sticker's center back until its rotated box lies fully inside the grid. When the box is
 * bigger than the grid on an axis it centers on that axis rather than going NaN.
 */
export function clampCenter(
  pos: Point,
  scale: number,
  aspect: number,
  rotationDeg = 0,
): Point {
  const { hx, hy } = halfExtents(scale, aspect, rotationDeg);
  const u = toUnits(pos);
  return fromUnits({
    x: clamp(u.x, hx, 1 - hx),
    y: clamp(u.y, hy, GRID_H_U - hy),
  });
}

/** True iff the sticker's rotated box lies entirely within the grid. The core invariant. */
export function isInsideGrid(
  pos: Point,
  scale: number,
  aspect: number,
  rotationDeg = 0,
): boolean {
  const { hx, hy } = halfExtents(scale, aspect, rotationDeg);
  const u = toUnits(pos);
  const eps = 1e-9;
  return (
    u.x - hx >= -eps &&
    u.x + hx <= 1 + eps &&
    u.y - hy >= -eps &&
    u.y + hy <= GRID_H_U + eps
  );
}

/** Snap a continuous angle (deg) to the nearest legal `rotation_deg` (8 × 45°). */
export function snapRotation(deg: number): RotationDeg {
  const step = STICKER.SNAP_DEG;
  const snapped = (((Math.round(deg / step) * step) % 360) + 360) % 360;
  return snapped as RotationDeg;
}

/** Live (non-deleted) stickers only. */
export function liveStickers(stickers: PlacedSticker[]): PlacedSticker[] {
  return live(stickers);
}

/** True iff another sticker may be placed on this month (the sanity cap, decision 6). */
export function canPlace(stickers: PlacedSticker[]): boolean {
  return liveStickers(stickers).length < STICKER.MAX_PER_MONTH;
}

/**
 * Where a tapped tray sticker lands (decision 13): at `wanted` — which the caller sets to the
 * center of the **visible** part of the grid, so a tap while scrolled to the far column doesn't
 * drop the sticker off-screen and read as "the tap did nothing" — clamped fully inside the grid.
 *
 * Repeat taps **cascade**: if a live sticker is already sitting on the target spot, step
 * diagonally down-right until a free one is found, so stamping the same sticker three times
 * makes three visible stickers rather than one invisible pile. The newest is always on top.
 *
 * Returns null at the 50-per-month cap (the caller must not write).
 */
export function placeSticker(
  existing: PlacedSticker[],
  aspect: number,
  wanted: Point,
): StickerPlacement | null {
  const rows = liveStickers(existing);
  if (rows.length >= STICKER.MAX_PER_MONTH) return null;

  const scale = clampScale(STICKER.DEFAULT_SCALE, aspect, 0);
  const target = toUnits(clampCenter(wanted, scale, aspect, 0));

  // The cascade chain: the first free slot down-right from the target.
  const occupied = (u: Point): boolean =>
    rows.some((s) => {
      const c = toUnits({ x: s.pos_x, y: s.pos_y });
      return Math.hypot(c.x - u.x, c.y - u.y) < STICKER.CASCADE / 2;
    });

  let pos = fromUnits(target);
  for (let i = 0; i < STICKER.CASCADE_STEPS; i++) {
    const step = i * STICKER.CASCADE;
    const candidate = clampCenter(
      fromUnits({ x: target.x + step, y: target.y + step }),
      scale,
      aspect,
      0,
    );
    pos = candidate;
    if (!occupied(toUnits(candidate))) break;
  }

  return {
    pos_x: pos.x,
    pos_y: pos.y,
    scale,
    rotation_deg: 0,
    layer_order: maxLayer(rows) + 1,
  };
}

// Front/back on a sticker is the same toggle as on a stamp — one implementation, shared.
export { isTopElement, toggleFrontBack } from "@/lib/gestures/layers";
