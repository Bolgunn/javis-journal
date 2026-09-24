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
  /** Day-cell width in the export, px. 7·36 so `CELL_H = 216` is exact, and a full-cell stamp
   *  (~252px) is ≈1:1 with its 256px thumb — "thumbnails included", literally and sharply. */
  CELL_W: 252,
  /** Weekday-header band height, px. */
  HEADER_H: 48,
  /** Weekday label font size, px. */
  WEEKDAY_FONT: 22,
  /** The optional month/year title band height, px (only present when `includeTitle`). */
  TITLE_BAND_H: 104,
  /** Title font size, px (Georgia — a system serif, always on her iPhone; decision 10). */
  TITLE_FONT: 60,
  /** Paper margin around the whole artifact, px — a little breathing room off the PNG edge. */
  OUTER_MARGIN: 28,
  /** Grid hairline thickness, px (device-pixel snapped in the plan so it stays crisp). */
  HAIRLINE_W: 2,
  /** Day-number size as a fraction of the cell width — matches DayCell's `CHIP_FONT_RATIO`. */
  DAY_FONT_RATIO: 0.073,
  /** Day-number inset from the cell's top-left, as a fraction of the font — matches DayCell. */
  DAY_PAD_RATIO: 0.28,
} as const;

/** Cell height — the 7:6 box, derived, never re-invented. */
export const EXPORT_CELL_H = EXPORT.CELL_W / CELL_ASPECT_RATIO; // 216
/** The day-grid's own width/height (`7·cellW × 6·cellH`) — the rect stickers are normalized to. */
export const EXPORT_GRID_W = EXPORT.CELL_W * 7; // 1764
export const EXPORT_GRID_H = EXPORT_CELL_H * 6; // 1296

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
  /** Full PNG size, px. */
  width: number;
  height: number;
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
 * Dimensions + the framed box / grid origin for a frame and title choice. Split out so tests can
 * assert the size math directly, and so the sheet could preflight a size without the row data.
 */
export function exportDimensions(frame: SelectedFrame, includeTitle: boolean) {
  const scale = frameScale(EXPORT_GRID_W); // ×4 at 1764px wide
  const inset = frameBoxInsets(frame, scale); // per-side ring+mat, {w,h}; {0,0} for 'none'
  const contentH = EXPORT.HEADER_H + EXPORT_GRID_H;
  const framedW = EXPORT_GRID_W + 2 * inset.w;
  const framedH = contentH + 2 * inset.h;
  const titleH = includeTitle ? EXPORT.TITLE_BAND_H : 0;

  const width = framedW + 2 * EXPORT.OUTER_MARGIN;
  const height = titleH + framedH + 2 * EXPORT.OUTER_MARGIN;

  const framedX = EXPORT.OUTER_MARGIN;
  const framedY = EXPORT.OUTER_MARGIN + titleH;
  // The header + grid begin inside the ring + mat.
  const gridX = framedX + inset.w;
  const headerY = framedY + inset.h;
  const gridY = headerY + EXPORT.HEADER_H;

  return {
    scale,
    inset,
    width,
    height,
    framedX,
    framedY,
    framedW,
    framedH,
    gridX,
    gridY,
    headerY,
    titleH,
  };
}

/**
 * Build the full draw-op plan for the VIEWED month. Pure: `todayISO()` is never called and there
 * is no today op — the export is identical whether or not the month is the real current month.
 */
export function buildExportPlan(input: ExportPlanInput): ExportPlan {
  const { year, month, weekStart, frame, includeTitle, stampsByDate, stickers, aspects } = input;
  const dims = exportDimensions(frame, includeTitle);
  const { scale, width, height, framedX, framedY, framedW, framedH, gridX, gridY, headerY } = dims;

  const ops: DrawOp[] = [];

  // 1. Paper everywhere — the whole framed box incl. the mat, the title band, the outer margin.
  ops.push({ kind: "background", w: width, h: height });

  // 2. The frame ring (behind the grid; it overhangs inward over the paper mat). `nineSliceRects`
  //    is the exact seam the CSS `border-image` reads — one geometry, two renderers.
  const frameSrc = frame === "none" ? null : FRAMES[frame].src;
  if (frame !== "none") {
    for (const piece of nineSliceRects(FRAMES[frame], framedW, framedH, scale)) {
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
    const x = gridX + col * EXPORT.CELL_W;
    const y = gridY + row * EXPORT_CELL_H;
    ops.push({
      kind: "cell",
      x,
      y,
      w: EXPORT.CELL_W,
      h: EXPORT_CELL_H,
      blank: cell === null,
    });
  });

  // 4. Weekday labels, in the header band, rotated to her week-start.
  const labels = weekdayLabels(weekStart);
  labels.forEach((text, col) => {
    ops.push({
      kind: "weekday",
      text: text.toUpperCase(),
      cx: gridX + col * EXPORT.CELL_W + EXPORT.CELL_W / 2,
      cy: headerY + EXPORT.HEADER_H / 2,
      fontPx: EXPORT.WEEKDAY_FONT,
    });
  });

  // 5. Grid hairlines — one clean table over header + grid (matches the on-screen borders).
  const hw = EXPORT.HAIRLINE_W;
  const half = hw / 2;
  // Verticals: 8 lines, from the header top to the grid bottom.
  const vTop = headerY;
  const vBottom = gridY + EXPORT_GRID_H;
  for (let c = 0; c <= 7; c++) {
    const lx = snap(gridX + c * EXPORT.CELL_W);
    ops.push({ kind: "hairline", x: lx - half, y: vTop, w: hw, h: vBottom - vTop });
  }
  // Horizontals: header top, header/grid seam, then each of the 6 grid rows' bottoms.
  const rowY = [headerY, gridY];
  for (let r = 1; r <= 6; r++) rowY.push(gridY + r * EXPORT_CELL_H);
  for (const y of rowY) {
    const ly = snap(y);
    ops.push({ kind: "hairline", x: gridX, y: ly - half, w: EXPORT_GRID_W, h: hw });
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
    const cellX = gridX + col * EXPORT.CELL_W;
    const cellY = gridY + row * EXPORT_CELL_H;
    for (const b of stampBoxes(stamps, aspects, EXPORT.CELL_W)) {
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
    const cellX = gridX + col * EXPORT.CELL_W;
    const cellY = gridY + row * EXPORT_CELL_H;
    const fontPx = Math.round(EXPORT.CELL_W * EXPORT.DAY_FONT_RATIO);
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
  for (const b of stickerBoxes(stickers, aspects, EXPORT_GRID_W)) {
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
      cy: EXPORT.OUTER_MARGIN + EXPORT.TITLE_BAND_H / 2,
      fontPx: EXPORT.TITLE_FONT,
    });
  }

  return { width, height, scale, frameSrc, ops };
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
