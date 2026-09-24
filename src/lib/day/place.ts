// ALG-8 — auto-placement, the 3-cap, layer order, and every clamp the day page's gestures
// need. Pure math: no React, no Dexie, no DOM.
//
// The coordinate model (M6, load-bearing):
//   - The day page IS the calendar cell zoomed — the same fixed 8:5 box (CELL_ASPECT).
//   - `pos_x`/`pos_y` ∈ [0,1] are the stamp's CENTER, as fractions of the page's width and
//     height respectively.
//   - `scale` is the stamp's WIDTH as a fraction of the page's WIDTH. Its height follows from
//     the baked stamp's own aspect — we never store a height.
//   - Internally we work in "page-width units" (u): the page is 1 wide and 1/PAGE_ASPECT tall,
//     so both axes share one unit and rotation is honest (rotating in normalized xy would
//     shear). `toPage` / `fromPage` convert at the boundary.
//
// EVERY tunable number lives in PLACEMENT. Retuning the feel is a one-object edit — the tests
// assert invariants (inside the page, cascades smaller, 3-cap), never the constants.

import { CELL_ASPECT_RATIO } from "@/lib/calendar/fit";
import type { RotationDeg, Stamp } from "@/lib/db/types";
import {
  isTopElement,
  live,
  maxLayer,
  toggleFrontBack as toggle,
} from "@/lib/gestures/layers";

/** The day page's aspect (width / height) — the calendar cell's, reused, never re-invented. */
export const PAGE_ASPECT = CELL_ASPECT_RATIO;

export const PLACEMENT = {
  /** Breathing room around the composition, as a fraction of the page's SHORTER side. */
  MARGIN: 0.06,
  /** The 2nd/3rd stamp enter at this fraction of max-fit, so they don't fully cover. */
  SECOND_SCALE: 0.62,
  /** Diagonal cascade offset per stamp, from the page center (page-width units). */
  CASCADE: 0.1,
  /** A day holds at most this many live stamps (also enforced by the Postgres trigger). */
  MAX_STAMPS: 3,
  /** A stamp can never be pinched smaller than this fraction of the page's width. (0.12 at the
   *  old 7:6 page; × 35/48 keeps the same smallest stamp relative to the page's height.) */
  MIN_SCALE: 0.0875,
  /** Rotation is snapped to multiples of this on gesture-end (8 legal values). */
  SNAP_DEG: 45,
} as const;

/** Center + size of a stamp, normalized to the page (`pos_*` / `scale` semantics). */
export type Placement = {
  pos_x: number;
  pos_y: number;
  scale: number;
  rotation_deg: RotationDeg;
  layer_order: number;
};

export type Point = { x: number; y: number };

const clamp = (v: number, lo: number, hi: number): number =>
  lo > hi ? (lo + hi) / 2 : v < lo ? lo : v > hi ? hi : v;

/** The page in page-width units: 1 wide, this tall. */
const PAGE_H_U = 1 / PAGE_ASPECT;
/** The margin in page-width units (it is a fraction of the shorter side = the height). */
const MARGIN_U = PLACEMENT.MARGIN / PAGE_ASPECT;

/** Normalized (pos_x, pos_y) → page-width units. */
export function toUnits(p: Point): Point {
  return { x: p.x, y: p.y * PAGE_H_U };
}

/** Page-width units → normalized (pos_x, pos_y). */
export function fromUnits(p: Point): Point {
  return { x: p.x, y: p.y / PAGE_H_U };
}

/**
 * Half-extents (page-width units) of the AXIS-ALIGNED BOUNDING BOX of a stamp of the given
 * scale/aspect rotated by `rotationDeg`. Every clamp below is an AABB test against the page,
 * which is exactly the "nothing can be pushed off the page" invariant.
 */
export function halfExtents(
  scale: number,
  aspect: number,
  rotationDeg: number,
): { hx: number; hy: number } {
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const w = scale; // width in page-width units
  const h = scale / aspect; // height in page-width units
  return { hx: (w * c + h * s) / 2, hy: (w * s + h * c) / 2 };
}

/**
 * The largest `scale` whose rotated box still fits inside the page minus `margin` (in
 * page-width units). Both axes constrain it; the tighter one wins — so a portrait stamp on the
 * landscape page is height-bound and leaves side margins (intended).
 */
export function maxFitScale(
  aspect: number,
  rotationDeg = 0,
  margin = MARGIN_U,
): number {
  const rad = (rotationDeg * Math.PI) / 180;
  const c = Math.abs(Math.cos(rad));
  const s = Math.abs(Math.sin(rad));
  const availW = Math.max(0, 1 - 2 * margin);
  const availH = Math.max(0, PAGE_H_U - 2 * margin);
  const byW = availW / (c + s / aspect);
  const byH = availH / (s + c / aspect);
  return Math.min(byW, byH);
}

/** Clamp a scale into `[MIN_SCALE, maxFit(rotation)]` — a stamp can never be scaled off-page. */
export function clampScale(
  scale: number,
  aspect: number,
  rotationDeg = 0,
  margin = 0,
): number {
  const max = maxFitScale(aspect, rotationDeg, margin);
  return clamp(scale, Math.min(PLACEMENT.MIN_SCALE, max), max);
}

/**
 * Pull a stamp's center back until its rotated box is fully inside the page (minus `margin`).
 * When the box is bigger than the available box on an axis it centers on that axis rather than
 * going NaN.
 */
export function clampCenter(
  pos: Point,
  scale: number,
  aspect: number,
  rotationDeg = 0,
  margin = 0,
): Point {
  const { hx, hy } = halfExtents(scale, aspect, rotationDeg);
  const u = toUnits(pos);
  return fromUnits({
    x: clamp(u.x, margin + hx, 1 - margin - hx),
    y: clamp(u.y, margin + hy, PAGE_H_U - margin - hy),
  });
}

/** True iff the stamp's rotated box lies entirely within the page. The core invariant. */
export function isInsidePage(
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
    u.y + hy <= PAGE_H_U + eps
  );
}

/** Snap a continuous angle (deg) to the nearest legal `rotation_deg` (8 × 45°). */
export function snapRotation(deg: number): RotationDeg {
  const step = PLACEMENT.SNAP_DEG;
  const snapped = ((Math.round(deg / step) * step) % 360 + 360) % 360;
  return snapped as RotationDeg;
}

// Layer order (front/back) is identical for a stamp and a sticker, so it lives in ONE place
// since M7 — `src/lib/gestures/layers.ts`. These are the day's doors onto it.
export { maxLayer, minLayer, bringToFront, sendToBack } from "@/lib/gestures/layers";

/** Live (non-deleted) stamps only — the cap, the cascade, and the layers all count these. */
export function liveStamps(stamps: Stamp[]): Stamp[] {
  return live(stamps);
}

/** True iff another stamp may be added to this day (the FAB is hidden when false). */
export function canPlace(stamps: Stamp[]): boolean {
  return liveStamps(stamps).length < PLACEMENT.MAX_STAMPS;
}

/**
 * ALG-8. Where a freshly cut stamp lands: the first is centered at max-fit; the 2nd/3rd enter
 * at `SECOND_SCALE × maxFit`, cascaded diagonally down-right so they don't fully cover what is
 * underneath — and clamped back inside the page if the cascade would push them off. The newest
 * is always on top. Returns null when the day is already at the 3-cap (the caller must not
 * write; the FAB is hidden and the DB trigger is the third line of defence).
 */
export function placeStamp(existing: Stamp[], aspect: number): Placement | null {
  const live = liveStamps(existing);
  if (live.length >= PLACEMENT.MAX_STAMPS) return null;

  const n = live.length;
  const fit = maxFitScale(aspect);
  const scale = n === 0 ? fit : PLACEMENT.SECOND_SCALE * fit;
  const offset = n * PLACEMENT.CASCADE;
  const centered = fromUnits({ x: 0.5, y: PAGE_H_U / 2 });
  const wanted = fromUnits({
    x: 0.5 + offset,
    y: PAGE_H_U / 2 + offset,
  });
  const pos = clampCenter(
    n === 0 ? centered : wanted,
    scale,
    aspect,
    0,
    MARGIN_U,
  );

  return {
    pos_x: pos.x,
    pos_y: pos.y,
    scale,
    rotation_deg: 0,
    layer_order: maxLayer(live) + 1,
  };
}

/** True iff `id` is the front-most live stamp (so a tap should send it to the back). */
export function isTopStamp(stamps: Stamp[], id: string): boolean {
  return isTopElement(stamps, id);
}

/**
 * The layer a tap should move `id` to: to the front if it is buried, to the back if it is
 * already on top. That toggle is the entire layer-order UI (ALG-9).
 */
export function toggleFrontBack(stamps: Stamp[], id: string): number {
  return toggle(stamps, id);
}
