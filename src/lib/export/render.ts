// M9 — the ONLY file in the export that touches a canvas. It consumes T1's pure draw-op plan +
// T2's decoded bitmaps + the live CSS token values, and rasterizes them onto an `OffscreenCanvas`
// (no mounted DOM node), then `convertToBlob()`s a PNG — the full 2160×1350 post, plus its two
// 1080×1350 carousel halves, each copied out of the one full canvas (M9-INSTAGRAM-PLAN
// decision 5), so the halves are the full image's pixels by construction.
//
// TAINT SAFETY (M9-PLAN decision 8): `drawImage` is only ever handed an `ImageBitmap` decoded
// from a same-origin/CORS-GET blob — never an `<img>` from a cross-origin signed URL. That is
// what keeps the canvas untainted so `convertToBlob()` cannot throw `SecurityError`. A render
// test asserts exactly this (the taint canary): every `drawImage` first-arg on the post canvas is
// an `ImageBitmap`, and the halves only ever copy from that (untainted) post canvas.
//
// Touches a canvas; no React, no Dexie.

import type { NineSlicePiece } from "@/lib/frames/nine-slice";
import type { DrawOp, ExportPlan } from "./plan";

/** The CSS token values read off `document.documentElement` at export time (decision 10). */
export type ExportTokens = {
  paper: string;
  line: string;
  lineSoft: string;
  ink: string;
  /** `--font-title` (Georgia serif) — the title band. */
  fontTitle: string;
  /** `--font-body` (system-ui) — weekday labels + day numbers. */
  fontBody: string;
};

/** The decoded, untainted bitmaps the plan's image ops reference. */
export type ExportBitmaps = {
  /** The 9-slice frame sheet, or null when the frame is `'none'`. */
  frame: ImageBitmap | null;
  /** image_id → decoded 256px thumb (stamps). */
  stamps: Map<string, ImageBitmap>;
  /** image_id → decoded 2048px main (stickers). */
  stickers: Map<string, ImageBitmap>;
};

/** So the raster is unit-testable off a mocked 2D context in a DOM-less test runner. */
export type CanvasFactory = (w: number, h: number) => OffscreenCanvas;

const defaultCanvasFactory: CanvasFactory = (w, h) => new OffscreenCanvas(w, h);

/** Draw a possibly-rotated bitmap about its center (mirrors the CSS `origin-center` + rotate). */
function drawRotated(
  ctx: OffscreenCanvasRenderingContext2D,
  bmp: ImageBitmap,
  box: { x: number; y: number; w: number; h: number; cx: number; cy: number; rot: number },
): void {
  if (box.rot === 0) {
    ctx.drawImage(bmp, box.x, box.y, box.w, box.h);
    return;
  }
  ctx.save();
  ctx.translate(box.cx, box.cy);
  ctx.rotate((box.rot * Math.PI) / 180);
  ctx.drawImage(bmp, -box.w / 2, -box.h / 2, box.w, box.h);
  ctx.restore();
}

/** Draw one 9-slice ring cell: a corner once, an edge as `tiles` whole copies (matches `round`). */
function drawFramePiece(
  ctx: OffscreenCanvasRenderingContext2D,
  sheet: ImageBitmap,
  piece: NineSlicePiece,
): void {
  const { src, dst, tiles, key } = piece;
  if (tiles == null || tiles <= 1) {
    ctx.drawImage(sheet, src.x, src.y, src.w, src.h, dst.x, dst.y, dst.w, dst.h);
    return;
  }
  const horizontal = key === "t" || key === "b";
  for (let i = 0; i < tiles; i++) {
    if (horizontal) {
      const w = dst.w / tiles;
      ctx.drawImage(sheet, src.x, src.y, src.w, src.h, dst.x + i * w, dst.y, w, dst.h);
    } else {
      const h = dst.h / tiles;
      ctx.drawImage(sheet, src.x, src.y, src.w, src.h, dst.x, dst.y + i * h, dst.w, h);
    }
  }
}

function drawText(
  ctx: OffscreenCanvasRenderingContext2D,
  op: Extract<DrawOp, { kind: "weekday" | "dayNumber" | "title" }>,
  tokens: ExportTokens,
): void {
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (op.kind === "title") {
    ctx.font = `${op.fontPx}px ${tokens.fontTitle}`;
    ctx.fillStyle = tokens.ink;
    ctx.fillText(op.text, op.cx, op.cy);
    return;
  }
  if (op.kind === "weekday") {
    ctx.font = `800 ${op.fontPx}px ${tokens.fontBody}`;
    ctx.fillStyle = tokens.ink;
    ctx.fillText(op.text, op.cx, op.cy);
    return;
  }
  // dayNumber: ink glyph with a paper halo (decision 10) so it stays legible over a stamp — the
  // canvas analogue of DayCell's paper `textShadow`. Stroke paper first, then fill ink.
  ctx.font = `bold ${op.fontPx}px ${tokens.fontBody}`;
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(2, op.fontPx * 0.22);
  ctx.strokeStyle = tokens.paper;
  ctx.strokeText(op.text, op.cx, op.cy);
  ctx.fillStyle = tokens.ink;
  ctx.fillText(op.text, op.cx, op.cy);
}

/** The finished PNGs: the whole post, and its left/right carousel halves (left first). */
export type ExportPngs = { full: Blob; halves: [Blob, Blob] };

/** Copy one vertical strip of the post into its own canvas (a carousel slide). */
function sliceCanvas(
  post: OffscreenCanvas,
  x: number,
  w: number,
  h: number,
  canvasFactory: CanvasFactory,
): OffscreenCanvas {
  const canvas = canvasFactory(w, h);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("export: no 2D context");
  ctx.drawImage(post, x, 0, w, h, 0, 0, w, h);
  return canvas;
}

/**
 * Rasterize the plan to PNG blobs — the full post and its two halves. Pixel art (the frame) is drawn with smoothing OFF for a crisp
 * nearest-neighbour ring; photos (stamps, stickers) with smoothing ON. A missing bitmap (an image
 * skipped by `data.ts` — offline and not on device) is simply not drawn; the PNG still succeeds.
 */
export async function renderExport(
  plan: ExportPlan,
  bitmaps: ExportBitmaps,
  tokens: ExportTokens,
  canvasFactory: CanvasFactory = defaultCanvasFactory,
): Promise<ExportPngs> {
  const canvas = canvasFactory(plan.width, plan.height);
  const ctx = canvas.getContext("2d") as OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error("export: no 2D context");

  for (const op of plan.ops) {
    switch (op.kind) {
      case "background":
        ctx.fillStyle = tokens.paper;
        ctx.fillRect(0, 0, op.w, op.h);
        break;
      case "frame":
        if (bitmaps.frame) {
          ctx.imageSmoothingEnabled = false;
          drawFramePiece(ctx, bitmaps.frame, op.piece);
        }
        break;
      case "cell":
        ctx.fillStyle = op.blank ? tokens.lineSoft : tokens.paper;
        ctx.fillRect(op.x, op.y, op.w, op.h);
        break;
      case "hairline":
        ctx.fillStyle = tokens.line;
        ctx.fillRect(op.x, op.y, op.w, op.h);
        break;
      case "weekday":
        drawText(ctx, op, tokens);
        break;
      case "stamp": {
        const bmp = bitmaps.stamps.get(op.imageId);
        if (bmp) {
          ctx.imageSmoothingEnabled = true;
          drawRotated(ctx, bmp, op.box);
        }
        break;
      }
      case "dayNumber":
        drawText(ctx, op, tokens);
        break;
      case "sticker": {
        const bmp = bitmaps.stickers.get(op.imageId);
        if (bmp) {
          ctx.imageSmoothingEnabled = true;
          drawRotated(ctx, bmp, op.box);
        }
        break;
      }
      case "title":
        drawText(ctx, op, tokens);
        break;
    }
  }

  const left = sliceCanvas(canvas, 0, plan.sliceW, plan.height, canvasFactory);
  const right = sliceCanvas(canvas, plan.sliceW, plan.width - plan.sliceW, plan.height, canvasFactory);
  const [full, a, b] = await Promise.all(
    [canvas, left, right].map((c) => c.convertToBlob({ type: "image/png" })),
  );
  return { full, halves: [a, b] };
}
