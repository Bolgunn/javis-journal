// M9 — the pure, DOM-free draw-op plan for the PNG export (US-12). This is the geometry half:
// given the VIEWED month + its already-loaded stamp/sticker rows, it produces a flat, ordered
// list of draw ops that `render.ts` rasterizes verbatim. It reuses every seam the on-screen
// calendar reads — `monthGrid`, `stampBoxes`, `stickerBoxes`, `nineSliceRects`, `frameBoxInsets`
// — so the PNG and the screen cannot drift (the whole point of the ADR-M5/M7/M8 geometry arc).
//
// Two invariants live here and are guarded by tests:
//   • The plan is a pure function of the passed `{year, month}` — `todayISO()` is NEVER read and
//     there is no "today" op. A shared July PNG must not wear a coloured disc on one day forever
//     (M9-PLAN decision 3). The absence of a today concept in this file IS that guarantee.
//   • Stamp/sticker rects equal `stampBoxes`/`stickerBoxes` (offset into the grid), so a sticker
//     clamped inside the grid on screen lands in the same place in the export.
//
// Pure: no React, no Dexie, no DOM, no canvas.

import { CELL_ASPECT_RATIO } from "@/lib/calendar/fit";
import { MONTH_NAMES, monthGrid, weekdayLabels } from "@/lib/calendar/month-grid";
import type { PlacedSticker, SelectedFrame, Stamp } from "@/lib/db/types";
import { stampBoxes } from "@/lib/day/layout";
import { stickerBoxes } from "@/lib/sticker/layout";
import { nineSliceRects, type NineSlicePiece } from "@/lib/frames/nine-slice";
import { FRAMES, frameBoxInsets, frameScale } from "@/lib/frames/spec";

/**
 * Every tunable number for the export lives here (mirroring `PLACEMENT`/`STICKER`). Retuning the
 * keepsake's size or feel is a one-object edit; the tests assert relationships (cells tile the
 * grid, rects equal the shared layout), never the constants.
 */
export const EXPORT = {
  /**
   * The post the month is laid out on — the INPUT, from which the cell size is derived
   * (M9-INSTAGRAM-PLAN decision 5). A two-photo Instagram carousel: 2 × 1080×1350 (4:5, the
   * tallest slide Instagram allows) side by side = one 2160×1350 panorama.
   */
  POST: { W: 2160, H: 1350 },
  /** Each carousel slide's width — the post is cut at `x = SLICE_W`. */
  SLICE_W: 1080,
  /** Weekday-header band height, px. */
  HEADER_H: 48,
  /** Weekday label font size, px. */
  WEEKDAY_FONT: 22,
  /** The optional month/year title band height, px (only present when `includeTitle`). */
  TITLE_BAND_H: 104,
  /** Title font size, px (Georgia — a system serif, always on her iPhone; decision 10). */
  TITLE_FONT: 60,
  /** Minimum paper margin around the framed box, px — breathing room off the PNG edge. */
  OUTER_MARGIN: 28,
  /** Grid hairline thickness, px (device-pixel snapped in the plan so it stays crisp). */
  HAIRLINE_W: 2,
  /** Day-number size as a fraction of the cell width — matches DayCell's `CHIP_FONT_RATIO`. */
  DAY_FONT_RATIO: 0.073,
  /** Day-number inset from the cell's top-left, as a fraction of the font — matches DayCell. */
  DAY_PAD_RATIO: 0.28,
} as const;

/** A positioned, possibly-rotated image box in absolute canvas pixels. */
export type PlacedBox = {
  /** Top-left of the UNROTATED box. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Center — the rotation pivot. */
  cx: number;
  cy: number;
  /** Degrees, clockwise. */
  rot: number;
};

/**
 * One draw op, in absolute canvas pixels. `render.ts` walks the ordered list once; the order IS
 * the z-order (background → frame → cells → weekday labels → hairlines → stamps → day numbers →
 * stickers → title). Only `stamp`/`sticker` reach `drawImage`; everything else is a fill or text.
 */
export type DrawOp =
  | { kind: "background"; w: number; h: number }
  | { kind: "frame"; piece: NineSlicePiece }
  | { kind: "cell"; x: number; y: number; w: number; h: number; blank: boolean }
  | { kind: "hairline"; x: number; y: number; w: number; h: number }
  | { kind: "weekday"; text: string; cx: number; cy: number; fontPx: number }
  | { kind: "stamp"; imageId: string; box: PlacedBox }
  | { kind: "dayNumber"; text: string; cx: number; cy: number; fontPx: number }
  | { kind: "sticker"; imageId: string; box: PlacedBox }
  | { kind: "title"; text: string; cx: number; cy: number; fontPx: number };

export type ExportPlan = {
  /** Full PNG size, px — always `EXPORT.POST`. */
  width: number;
  height: number;
  /** Where the post is cut into its two carousel slides (`EXPORT.SLICE_W`). */
  sliceW: number;
  /** The frame scale used for the ring + mat (`frameScale(gridWidth)` → ×4 at this resolution). */
  scale: number;
  /** The 9-slice tile sheet to load, or null when the frame is `'none'`. */
  frameSrc: string | null;
  /** The ordered draw list. */
  ops: DrawOp[];
};

export type ExportPlanInput = {
  year: number;
  /** 1-indexed. */
  month: number;
  /** ISO week-start, 1 = Mon … 7 = Sun. */
  weekStart: number;
  frame: SelectedFrame;
  /** Composite the month/year title band above the framed box. */
  includeTitle: boolean;
  /** The month's live stamps, keyed by `YYYY-MM-DD` (from `data.ts`). */
  stampsByDate: Map<string, Stamp[]>;
  /** The month's live stickers (from `data.ts`). */
  stickers: PlacedSticker[];
  /** image_id → baked aspect (width / height), for both stamps and stickers. */
  aspects: Map<string, number>;
};

/** Snap a coordinate to a device-pixel boundary so a 2px hairline stays crisp, not blurred. */
function snap(v: number): number {
  return Math.round(v);
}

/**
 * The post's geometry for a frame and title choice — the cell size, the framed box, the grid
 * origin. Split out so tests can assert the size math directly.
 *
 * The post size is fixed; the cells are what give (decision 5). The title band, margins, weekday
 * header and the ring's top/bottom ring+mat come off the height, the ring's sides off the width,
 * and `cellW` is the smaller of the two bounds at 8:5 — floored to whole px so the columns land
 * on a steady pitch. Whatever is left over is absorbed:
 *   • horizontally, by the ring: it spans the full post width and its side edges are drawn wider
 *     by exactly the leftover (`sideStretch` per side), so the ring still hugs the grid and the
 *     grid stays centred — which puts the cut at x = 1080 through the middle of column 4
 *     (decision 6). With frame `'none'` the leftover is plain paper.
 *   • vertically, by centring the title + framed box on the post.
 */
export function exportDimensions(frame: SelectedFrame, includeTitle: boolean) {
  const { W, H } = EXPORT.POST;
  const M = EXPORT.OUTER_MARGIN;
  const titleH = includeTitle ? EXPORT.TITLE_BAND_H : 0;

  // The ring's scale is stepped off the grid width, as on screen. Any plausible grid on a 2160px
  // post is >= 1024 wide, so this is x4 — asserted by a test, and needed before the cell math
  // (the ring's inset depends on it).
  const scale = frameScale(W - 2 * M);
  const inset = frameBoxInsets(frame, scale); // per-side ring+mat, {w,h}; {0,0} for 'none'

  const availW = W - 2 * M - 2 * inset.w;
  const availH = H - 2 * M - titleH - EXPORT.HEADER_H - 2 * inset.h;
  const cellW = Math.max(
    0,
    Math.floor(Math.min(availW / 7, (availH / 6) * CELL_ASPECT_RATIO)),
  );
  const cellH = cellW / CELL_ASPECT_RATIO;
  const gridW = cellW * 7;
  const gridH = cellH * 6;

  // Horizontal leftover, per side — the ring's side edges widen by exactly this.
  const sideStretch = (availW - gridW) / 2;

  const framedX = M;
  const framedW = W - 2 * M;
  const framedH = EXPORT.HEADER_H + gridH + 2 * inset.h;
  // Vertical leftover: centre the title + framed box on the post.
  const titleY = (H - titleH - framedH) / 2;
  const framedY = titleY + titleH;

  // The header + grid begin inside the ring + mat (and the stretch).
  const gridX = framedX + inset.w + sideStretch;
  const headerY = framedY + inset.h;
  const gridY = headerY + EXPORT.HEADER_H;

  return {
    scale,
    inset,
    width: W,
    height: H,
    cellW,
    cellH,
    gridW,
    gridH,
    sideStretch,
    framedX,
    framedY,
    framedW,
    framedH,
    gridX,
    gridY,
    headerY,
    titleH,
    titleY,
  };
}

/**
 * The destination width of one of the ring's side 9-slice columns once its edge is widened by
 * `stretch`. The source column is `slice` px wide, of which the outer `ink` px are the ring itself
 * (the surplus overhangs inward, transparent). Stretching the column so its INK band grows by
 * exactly `stretch` keeps the paper mat between ring and grid as wide as it is on screen.
 */
export function stretchedSideW(slice: number, ink: number, scale: number, stretch: number): number {
  return slice * (scale + stretch / ink);
}

/**
 * Build the full draw-op plan for the VIEWED month. Pure: `todayISO()` is never called and there
 * is no today op — the export is identical whether or not the month is the real current month.
 */
export function buildExportPlan(input: ExportPlanInput): ExportPlan {
  const { year, month, weekStart, frame, includeTitle, stampsByDate, stickers, aspects } = input;
  const dims = exportDimensions(frame, includeTitle);
  const { scale, width, height, framedX, framedY, framedW, framedH, gridX, gridY, headerY } = dims;
  const { cellW, cellH, gridW, gridH, sideStretch } = dims;

  const ops: DrawOp[] = [];

  // 1. Paper everywhere — the whole framed box incl. the mat, the title band, the outer margin.
  ops.push({ kind: "background", w: width, h: height });

  // 2. The frame ring (behind the grid; it overhangs inward over the paper mat). `nineSliceRects`
  //    is the exact seam the CSS `border-image` reads — one geometry, two renderers.
  const frameSrc = frame === "none" ? null : FRAMES[frame].src;
  if (frame !== "none") {
    const spec = FRAMES[frame];
    const sideW = {
      l: stretchedSideW(spec.slice.l, spec.ink.l, scale, sideStretch),
      r: stretchedSideW(spec.slice.r, spec.ink.r, scale, sideStretch),
    };
    for (const piece of nineSliceRects(spec, framedW, framedH, scale, sideW)) {
      ops.push({
        kind: "frame",
        piece: {
          ...piece,
          dst: { ...piece.dst, x: piece.dst.x + framedX, y: piece.dst.y + framedY },
        },
      });
    }
  }

  // 3. The 42 cells. Numbered = paper; leading/trailing blanks = line-soft (matches DayCell).
  const cells = monthGrid(year, month, weekStart);
  cells.forEach((cell, i) => {
    const col = i % 7;
    const row = Math.floor(i / 7);
    const x = gridX + col * cellW;
    const y = gridY + row * cellH;
    ops.push({
      kind: "cell",
      x,
      y,
      w: cellW,
      h: cellH,
      blank: cell === null,
    });
  });

  // 4. Weekday labels, in the header band, rotated to her week-start.
  const labels = weekdayLabels(weekStart);
  labels.forEach((text, col) => {
    ops.push({
      kind: "weekday",
      text: text.toUpperCase(),
      cx: gridX + col * cellW + cellW / 2,
      cy: headerY + EXPORT.HEADER_H / 2,
      fontPx: EXPORT.WEEKDAY_FONT,
    });
  });

  // 5. Grid hairlines — one clean table over header + grid (matches the on-screen borders).
  const hw = EXPORT.HAIRLINE_W;
  const half = hw / 2;
  // Verticals: 8 lines, from the header top to the grid bottom.
  const vTop = headerY;
  const vBottom = gridY + gridH;
  for (let c = 0; c <= 7; c++) {
    const lx = snap(gridX + c * cellW);
    ops.push({ kind: "hairline", x: lx - half, y: vTop, w: hw, h: vBottom - vTop });
  }
  // Horizontals: header top, header/grid seam, then each of the 6 grid rows' bottoms.
  const rowY = [headerY, gridY];
  for (let r = 1; r <= 6; r++) rowY.push(gridY + r * cellH);
  for (const y of rowY) {
    const ly = snap(y);
    ops.push({ kind: "hairline", x: gridX, y: ly - half, w: gridW, h: hw });
  }

  // 6. Stamp thumbnails — every day's faithful mini-composition, through the SAME `stampBoxes`
  //    the day page and the calendar cell use, offset into the cell. Grouped after the cell fills
  //    so the draw-image sequence is frame → stamps → stickers (the render taint canary checks it).
  cells.forEach((cell, i) => {
    if (cell === null) return;
    const stamps = stampsByDate.get(cell.date);
    if (!stamps || stamps.length === 0) return;
    const col = i % 7;
    const row = Math.floor(i / 7);
    const cellX = gridX + col * cellW;
    const cellY = gridY + row * cellH;
    for (const b of stampBoxes(stamps, aspects, cellW)) {
      ops.push({
        kind: "stamp",
        imageId: b.image_id,
        box: {
          x: cellX + b.x,
          y: cellY + b.y,
          w: b.w,
          h: b.h,
          cx: cellX + b.cx,
          cy: cellY + b.cy,
          rot: b.rot,
        },
      });
    }
  });

  // 7. Day numbers — over the stamps, ink glyph with a paper halo (decision 10), NO today disc.
  cells.forEach((cell, i) => {
    if (cell === null) return;
    const col = i % 7;
    const row = Math.floor(i / 7);
    const cellX = gridX + col * cellW;
    const cellY = gridY + row * cellH;
    const fontPx = Math.round(cellW * EXPORT.DAY_FONT_RATIO);
    const pad = Math.round(fontPx * EXPORT.DAY_PAD_RATIO);
    const chip = fontPx * 1.9; // DayCell's minWidth/height
    ops.push({
      kind: "dayNumber",
      text: String(cell.day),
      cx: cellX + pad + chip / 2,
      cy: cellY + pad + chip / 2,
      fontPx,
    });
  });

  // 8. Stickers — the top layer over the whole grid, through the SAME `stickerBoxes`, offset by
  //    the grid origin (the sticker coordinate box IS the day-grid bbox).
  for (const b of stickerBoxes(stickers, aspects, gridW)) {
    ops.push({
      kind: "sticker",
      imageId: b.image_id,
      box: {
        x: gridX + b.x,
        y: gridY + b.y,
        w: b.w,
        h: b.h,
        cx: gridX + b.cx,
        cy: gridY + b.cy,
        rot: b.rot,
      },
    });
  }

  // 9. The optional title band, centered above the framed box, in Georgia.
  if (includeTitle) {
    ops.push({
      kind: "title",
      text: `${MONTH_NAMES[month - 1]} ${year}`,
      cx: width / 2,
      cy: dims.titleY + EXPORT.TITLE_BAND_H / 2,
      fontPx: EXPORT.TITLE_FONT,
    });
  }

  return { width, height, sliceW: EXPORT.SLICE_W, scale, frameSrc, ops };
}

/** The image ids the export needs, split by which blob resolution `data.ts` should fetch. */
export function exportImageIds(input: {
  stampsByDate: Map<string, Stamp[]>;
  stickers: PlacedSticker[];
}): { stamps: string[]; stickers: string[] } {
  const stamps = new Set<string>();
  for (const list of input.stampsByDate.values()) {
    for (const s of list) if (s.deleted_at == null) stamps.add(s.image_id);
  }
  const stickers = new Set<string>();
  for (const s of input.stickers) if (s.deleted_at == null) stickers.add(s.image_id);
  return { stamps: [...stamps], stickers: [...stickers] };
}
