// M8 — the seam M9 inherits. CSS `border-image` does not apply to a canvas (DESIGN ALG-7), so
// the PNG export has to rasterize the frame as a manual 9-slice. Rather than leave M9 to
// re-derive the geometry from the CSS, both paths read the same FRAMES object through this
// function: M9's export is `load(spec.src)` → `nineSliceRects(...)` → 8 × `drawImage`, and the
// two renderings cannot drift.
//
// Pure: no React, no Dexie, no DOM.

import type { FrameSpec } from "./spec";

export type Rect = { x: number; y: number; w: number; h: number };

/** One of the 8 ring cells. The centre is deliberately absent — we never use `slice: fill`. */
export type NineSliceKey = "tl" | "t" | "tr" | "r" | "br" | "b" | "bl" | "l";

export type NineSlicePiece = {
  key: NineSliceKey;
  /** Source rect in the tile sheet, in sheet px. */
  src: Rect;
  /** Destination rect, in px relative to the ring's outer box. */
  dst: Rect;
  /**
   * For an edge: the whole number of tiles `border-image-repeat: round` fits along it — a
   * canvas renderer must draw this many copies of `src` across `dst` to match the CSS. Null
   * for a corner, which is never tiled and never scaled along its run.
   */
  tiles: number | null;
};

/**
 * The 8 ring rects for a frame drawn into a `w × h` outer box at `scale`.
 *
 * The outer box is the ring as *drawn* — i.e. the border box grown by `border-image-outset`
 * on each side — so the corner cells are `slice × scale`, not `ink × scale`. Source rects tile
 * the sheet exactly (`l | period | r` × `t | period | b`, centre skipped); destination rects
 * tile the ring exactly.
 *
 * `sideW` (export only — the CSS path never passes it) overrides the destination width of the
 * left and right columns, the canvas analogue of a per-side `border-image-width`: the PNG export
 * stretches the side pixels so the ring can span the full 2160px post while still hugging the
 * grid (M9-INSTAGRAM-PLAN decision 5). The corners stretch horizontally with their column.
 */
export function nineSliceRects(
  spec: FrameSpec,
  w: number,
  h: number,
  scale: number,
  sideW?: { l: number; r: number },
): NineSlicePiece[] {
  const { slice, period, sheetW, sheetH } = spec;

  // Source columns/rows: the sheet is exactly corner | one period | corner on both axes.
  const sx = [0, slice.l, slice.l + period, sheetW];
  const sy = [0, slice.t, slice.t + period, sheetH];

  // Destination columns/rows: corners at their scaled slice size, the edges take the rest.
  const left = sideW?.l ?? slice.l * scale;
  const right = sideW?.r ?? slice.r * scale;
  const dx = [0, left, w - right, w];
  const dy = [0, slice.t * scale, h - slice.b * scale, h];

  const tileW = period * scale;
  const tileH = period * scale;
  /** `round` fits a whole number of tiles, never fewer than one. */
  const fit = (run: number, tile: number) => Math.max(1, Math.round(run / tile));

  const runW = Math.max(0, dx[2] - dx[1]);
  const runH = Math.max(0, dy[2] - dy[1]);

  const cell = (
    key: NineSliceKey,
    ci: number,
    ri: number,
    tiles: number | null,
  ): NineSlicePiece => ({
    key,
    src: { x: sx[ci], y: sy[ri], w: sx[ci + 1] - sx[ci], h: sy[ri + 1] - sy[ri] },
    dst: { x: dx[ci], y: dy[ri], w: dx[ci + 1] - dx[ci], h: dy[ri + 1] - dy[ri] },
    tiles,
  });

  const across = fit(runW, tileW);
  const down = fit(runH, tileH);

  return [
    cell("tl", 0, 0, null),
    cell("t", 1, 0, across),
    cell("tr", 2, 0, null),
    cell("l", 0, 1, down),
    cell("r", 2, 1, down),
    cell("bl", 0, 2, null),
    cell("b", 1, 2, across),
    cell("br", 2, 2, null),
  ];
}
