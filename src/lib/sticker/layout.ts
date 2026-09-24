// The ONE composition function for a month's sticker layer — shared by the layer itself, the
// /dev/stickers harness, and (later, M9) the PNG export, exactly as `day/layout.ts` is for
// stamps. Normalized sticker rows → positioned pixel boxes inside the day-grid bbox.
//
// Pure: no React, no Dexie, no DOM.

import type { PlacedSticker } from "@/lib/db/types";
import type { Box, LiveTransform } from "@/lib/gestures/machine";
import { GRID_ASPECT, liveStickers } from "./place";

/** A sticker's on-screen box: the UNROTATED rect (CSS positions it, then rotates about center). */
export type StickerBox = Box & {
  image_id: string;
  /** Top-left of the unrotated box, in grid pixels. */
  x: number;
  y: number;
};

/** Grid height for a given grid width — the 28/15 box (GRID_ASPECT), never re-derived elsewhere. */
export function gridHeight(gridW: number): number {
  return gridW / GRID_ASPECT;
}

/**
 * The image's aspect (width / height). Falls back to 1 when the `images` row hasn't landed yet
 * (a fresh pull on a second device) — a square box is a sane placeholder and never NaNs the
 * layout.
 */
export function aspectOf(
  imageId: string,
  aspects: Map<string, number> | undefined,
): number {
  const a = aspects?.get(imageId);
  return a && Number.isFinite(a) && a > 0 ? a : 1;
}

/**
 * Overlay a live (uncommitted) gesture transform onto a persisted box. The gesture writes once,
 * on gesture-end; until then the layer renders from this — one function, so the sticker, its
 * selection glow and its ✕ can never disagree about where it is.
 */
export function applyLive(
  box: StickerBox,
  live: LiveTransform | null,
  gridW: number,
): StickerBox {
  if (!live) return box;
  const aspect = box.w / box.h;
  const w = live.scale * gridW;
  const h = w / aspect;
  const cx = live.pos_x * gridW;
  const cy = live.pos_y * gridHeight(gridW);
  return { ...box, x: cx - w / 2, y: cy - h / 2, w, h, cx, cy, rot: live.rotation_deg };
}

/**
 * Compose a month's sticker layer: its live stickers, back-to-front, as pixel boxes inside a
 * `gridW`-wide GRID_ASPECT grid box. `scale` is the sticker's width as a fraction of the grid width;
 * the height follows from the image's own aspect.
 */
export function stickerBoxes(
  stickers: PlacedSticker[],
  aspects: Map<string, number> | undefined,
  gridW: number,
): StickerBox[] {
  const gridH = gridHeight(gridW);

  return liveStickers(stickers)
    .slice()
    .sort((a, b) => a.layer_order - b.layer_order || (a.id < b.id ? -1 : 1))
    .map((s) => {
      const w = s.scale * gridW;
      const h = w / aspectOf(s.image_id, aspects);
      const cx = s.pos_x * gridW;
      const cy = s.pos_y * gridH;
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
