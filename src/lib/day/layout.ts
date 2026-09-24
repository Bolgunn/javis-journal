// The ONE layout function shared by the day page, the calendar cell's mini-composition, and
// (later, M9) the PNG export: normalized stamp rows -> positioned pixel boxes. Because the cell
// and the page are the same 8:5 box in the same normalized coordinates, this is literally the
// same composition at two pixel sizes — which is why the FLIP zoom has nothing to cross-fade.
//
// Pure: no React, no Dexie, no DOM.

import type { Stamp } from "@/lib/db/types";
import { PAGE_ASPECT, liveStamps } from "./place";

/** A stamp's on-screen box: the UNROTATED rect (CSS positions it, then rotates about center). */
export type StampBox = {
  id: string;
  image_id: string;
  /** Top-left of the unrotated box, in page pixels. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Center, in page pixels — the rotation pivot, and what hit-testing works against. */
  cx: number;
  cy: number;
  rot: number;
  /** `layer_order`, straight through to `z-index`. */
  z: number;
};

/** Page height for a given page width — the 8:5 box, never re-derived elsewhere. */
export function pageHeight(pageW: number): number {
  return pageW / PAGE_ASPECT;
}

/**
 * Overlay a live (uncommitted) gesture transform onto a persisted box. The gesture writes once,
 * on gesture-end; until then the page renders from this — one function, so the stamp, its
 * selection glow and its ✕ can never disagree about where it is.
 */
export function applyLive(
  box: StampBox,
  live: { pos_x: number; pos_y: number; scale: number; rotation_deg: number } | null,
  pageW: number,
): StampBox {
  if (!live) return box;
  const aspect = box.w / box.h;
  const w = live.scale * pageW;
  const h = w / aspect;
  const cx = live.pos_x * pageW;
  const cy = live.pos_y * pageHeight(pageW);
  return { ...box, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy, rot: live.rotation_deg };
}

/**
 * The baked aspect of a stamp's image (width / height). Falls back to 1 when the `images` row
 * hasn't landed yet (a fresh pull on a second device) — a square box is a sane placeholder and
 * never NaNs the layout.
 */
export function aspectOf(
  imageId: string,
  aspects: Map<string, number> | undefined,
): number {
  const a = aspects?.get(imageId);
  return a && Number.isFinite(a) && a > 0 ? a : 1;
}

/**
 * Compose a day: its live stamps, back-to-front, as pixel boxes inside a `pageW`-wide 8:5 page.
 * `scale` is the stamp's width as a fraction of the page width; the height follows from the
 * baked image's own aspect.
 */
export function stampBoxes(
  stamps: Stamp[],
  aspects: Map<string, number> | undefined,
  pageW: number,
): StampBox[] {
  const pageH = pageHeight(pageW);

  return liveStamps(stamps)
    .slice()
    .sort((a, b) => a.layer_order - b.layer_order || (a.id < b.id ? -1 : 1))
    .map((s) => {
      const w = s.scale * pageW;
      const h = w / aspectOf(s.image_id, aspects);
      const cx = s.pos_x * pageW;
      const cy = s.pos_y * pageH;
      return {
        id: s.id,
        image_id: s.image_id,
        x: cx - w / 2,
        y: cy - h / 2,
        w,
        h,
        cx,
        cy,
        rot: s.rotation_deg,
        z: s.layer_order,
      };
    });
}
