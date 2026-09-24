// M9 — the export composer (M9-PLAN decision 12). Wires the pure/seam layers into one call: read
// the month from Dexie (`data.ts`, untainted blobs) → decode them off-thread in small batches
// (`createImageBitmap`) → build the draw-op plan (`plan.ts`) → rasterize (`render.ts`) → a PNG
// set of PNGs (the full 2160×1350 post + its two carousel halves). The caller (ExportSheet / the
// harness) then hands whichever it wants to `save.ts`'s `downloadBlob`.
//
// `year/month` are `Calendar`'s VIEWED `{year, month}` state, passed straight through — the export
// never reads `todayISO()`. Non-blocking without a worker: `createImageBitmap` already decodes off
// the main thread (decision 9), so we `await` batched decodes then draw synchronously.
//
// Browser-only (createImageBitmap, OffscreenCanvas, document). No React.

import type { SelectedFrame } from "@/lib/db/types";
import { loadExportData } from "./data";
import { buildExportPlan } from "./plan";
import {
  renderExport,
  type ExportBitmaps,
  type ExportPngs,
  type ExportTokens,
} from "./render";

export type { ExportPngs };

/** How many blobs to decode in parallel — enough to be fast, few enough to bound peak memory. */
const DECODE_BATCH = 6;

/** Read the shipped `pastel` theme's colours + fonts off the root element (decision 10). */
function readTokens(): ExportTokens {
  const s = getComputedStyle(document.documentElement);
  const v = (name: string) => s.getPropertyValue(name).trim();
  return {
    paper: v("--color-paper") || "#fffdf8",
    line: v("--color-line") || "#eadad1",
    lineSoft: v("--color-line-soft") || "#f2e6df",
    ink: v("--color-ink") || "#3b332f",
    fontTitle: v("--font-title") || "Georgia, serif",
    fontBody: v("--font-body") || "system-ui, sans-serif",
  };
}

/** Decode a map of untainted blobs to bitmaps, in small parallel batches. A blob that fails to
 *  decode is dropped (the image is simply not drawn — the PNG still succeeds). */
async function decodeBitmaps(blobs: Map<string, Blob>): Promise<Map<string, ImageBitmap>> {
  const out = new Map<string, ImageBitmap>();
  const entries = [...blobs.entries()];
  for (let i = 0; i < entries.length; i += DECODE_BATCH) {
    const batch = entries.slice(i, i + DECODE_BATCH);
    const decoded = await Promise.all(
      batch.map(async ([id, blob]) => {
        try {
          return [id, await createImageBitmap(blob)] as const;
        } catch {
          return null;
        }
      }),
    );
    for (const d of decoded) if (d) out.set(d[0], d[1]);
  }
  return out;
}

/** The frame's 9-slice sheet is same-origin (`/frames/*.png`) so it never taints the canvas. */
async function loadFrameBitmap(src: string | null): Promise<ImageBitmap | null> {
  if (!src) return null;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    return await createImageBitmap(await res.blob());
  } catch {
    return null;
  }
}

/**
 * Compose the VIEWED month into its PNGs — everything except the final save. The `/dev/export`
 * harness uses this directly to render into `<img>`s without a download.
 */
export async function composeMonthPng(
  year: number,
  month: number,
  weekStart: number,
  frame: SelectedFrame,
  includeTitle: boolean,
): Promise<ExportPngs> {
  const data = await loadExportData(year, month);

  const plan = buildExportPlan({
    year,
    month,
    weekStart,
    frame,
    includeTitle,
    stampsByDate: data.stampsByDate,
    stickers: data.stickers,
    aspects: data.aspects,
  });

  const [frameBmp, stamps, stickers] = await Promise.all([
    loadFrameBitmap(plan.frameSrc),
    decodeBitmaps(data.stampBlobs),
    decodeBitmaps(data.stickerBlobs),
  ]);

  // System fonts (Georgia / system-ui) are always present; this is cheap insurance so the first
  // export after load doesn't measure a not-yet-ready font (decision 10).
  if (document.fonts?.ready) await document.fonts.ready;

  const bitmaps: ExportBitmaps = { frame: frameBmp, stamps, stickers };
  try {
    return await renderExport(plan, bitmaps, readTokens());
  } finally {
    // Release the decoded bitmaps promptly — a cold export shouldn't leave dozens live.
    frameBmp?.close();
    for (const b of stamps.values()) b.close();
    for (const b of stickers.values()) b.close();
  }
}
