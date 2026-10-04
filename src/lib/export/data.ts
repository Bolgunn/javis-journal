// M9 — the export's Dexie read seam (M9-PLAN decision 8, 12). The PNG is composed on a canvas
// via `convertToBlob()`, which throws `SecurityError` the moment the canvas is TAINTED — and a
// remote-miss thumb from `getThumbUrls` is a cross-origin signed Supabase URL, so drawing an
// `<img>` from it would taint. This seam therefore yields BLOBS, never URLs:
//   • local-first — read `db.image_blobs` (`thumb` for stamps, `main` for stickers) directly;
//   • on a local miss, mint a signed URL and `fetch()` it to a `.blob()` (signed URLs are
//     CORS-GETtable), which `createImageBitmap` decodes into an untainted bitmap;
//   • a TOTAL miss (offline AND not on device) simply SKIPS that one image — the export still
//     succeeds; we never abort the whole PNG for one unresolved photo.
//
// The reactive display hooks (`queries.ts`) are the wrong tool here: they manage object-URL
// handles for on-screen rendering. This is a one-shot read for a cold, occasional export.
//
// Reads Dexie + Supabase; no React, no canvas.

import { monthRange, yearMonthKey } from "@/lib/calendar/month-grid";
import { db } from "@/lib/db";
import type { ImageBlobRow } from "@/lib/db/image-types";
import type { ImageRow, PlacedSticker, Stamp } from "@/lib/db/types";
import { isGuest } from "@/lib/auth/identity";
import { createClient } from "@/lib/supabase/browser";

const BUCKET = "images";
const SIGNED_EXPIRES_SEC = 60 * 60; // a short-lived URL is plenty for one fetch

export type ExportData = {
  /** Live stamps of the month, keyed by `YYYY-MM-DD`. */
  stampsByDate: Map<string, Stamp[]>;
  /** Live stickers on the month. */
  stickers: PlacedSticker[];
  /** image_id → baked aspect (width / height), for both stamps and stickers. */
  aspects: Map<string, number>;
  /** image_id → 256px thumb blob (stamps). A skipped (unresolvable) image is simply absent. */
  stampBlobs: Map<string, Blob>;
  /** image_id → 2048px main blob (stickers). A skipped image is simply absent. */
  stickerBlobs: Map<string, Blob>;
};

/** Live (non-tombstoned) rows only, ordered back-to-front, ties broken by id. */
function orderLive<T extends { deleted_at: string | null; layer_order: number; id: string }>(
  rows: T[],
): T[] {
  return rows
    .filter((r) => r.deleted_at == null)
    .sort((a, b) => a.layer_order - b.layer_order || (a.id < b.id ? -1 : 1));
}

/** image_id → aspect, from the local `images` rows. A row with no dims simply doesn't appear. */
async function imageAspects(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const rows = await db.images.bulkGet(ids);
  for (const row of rows) {
    if (row?.width && row.height) out.set(row.id, row.width / row.height);
  }
  return out;
}

/**
 * Resolve a set of image ids to untainted blobs. `pick` chooses `thumb` (stamps) or `main`
 * (stickers) from the local blob row; `pathOf` is the storage path to sign on a local miss.
 * Missing-while-offline images are omitted from the result (decision 8's skip, not an abort).
 */
async function resolveBlobs(
  ids: string[],
  pick: (row: ImageBlobRow) => Blob | null,
  pathOf: (row: ImageRow) => string,
): Promise<Map<string, Blob>> {
  const out = new Map<string, Blob>();
  if (ids.length === 0) return out;

  const [blobRows, imageRows] = await Promise.all([
    db.image_blobs.bulkGet(ids),
    db.images.bulkGet(ids),
  ]);

  const misses: { id: string; path: string }[] = [];
  ids.forEach((id, i) => {
    const local = blobRows[i] ? pick(blobRows[i]!) : null;
    if (local) {
      out.set(id, local);
      return;
    }
    const imageRow = imageRows[i];
    if (imageRow) misses.push({ id, path: pathOf(imageRow) });
  });

  if (misses.length > 0) {
    const signed = await signPaths(misses);
    await Promise.all(
      misses.map(async ({ id }) => {
        const url = signed.get(id);
        if (!url) return; // could not sign (offline / error) → skip this image
        try {
          const res = await fetch(url);
          if (!res.ok) return;
          out.set(id, await res.blob());
        } catch {
          // offline for this one image → skip it; the rest of the PNG still renders
        }
      }),
    );
  }

  return out;
}

/** One `createSignedUrls` round-trip for the remote misses. Signing failures drop those ids. */
async function signPaths(
  misses: { id: string; path: string }[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  // M11: a guest's images are only ever local — a miss is skipped like an offline one, never signed.
  if (isGuest()) return out;
  try {
    const supabase = createClient();
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrls(
        misses.map((m) => m.path),
        SIGNED_EXPIRES_SEC,
      );
    if (error || !data) return out;
    // createSignedUrls preserves input order.
    data.forEach((entry, i) => {
      const miss = misses[i];
      if (!miss || entry.error || !entry.signedUrl) return;
      out.set(miss.id, entry.signedUrl);
    });
  } catch {
    // no client / offline → every miss is skipped, export proceeds with what resolved
  }
  return out;
}

/**
 * Load everything the export of one VIEWED month needs: its live stamp rows (by date), its live
 * stickers, the aspects, and untainted blobs — thumbs for stamps (≈1:1 at cell size), mains for
 * stickers (they can scale to ~2 cells; thumbs would be soft). `year/month` is the viewed month;
 * this reads no clock.
 */
export async function loadExportData(year: number, month: number): Promise<ExportData> {
  const { start, endExclusive } = monthRange(year, month);

  const entries = await db.entries
    .where("entry_date")
    .between(start, endExclusive, true, false)
    .toArray();

  const stampsByDate = new Map<string, Stamp[]>();
  if (entries.length > 0) {
    const dateByEntryId = new Map(entries.map((e) => [e.id, e.entry_date]));
    const stamps = await db.stamps
      .where("entry_id")
      .anyOf([...dateByEntryId.keys()])
      .toArray();

    const byEntry = new Map<string, Stamp[]>();
    for (const s of stamps) {
      const list = byEntry.get(s.entry_id);
      if (list) list.push(s);
      else byEntry.set(s.entry_id, [s]);
    }
    for (const [entryId, list] of byEntry) {
      const date = dateByEntryId.get(entryId);
      const live = orderLive(list);
      if (date && live.length > 0) stampsByDate.set(date, live);
    }
  }

  const stickerRows = await db.placed_stickers
    .where("year_month")
    .equals(yearMonthKey(year, month))
    .toArray();
  const stickers = orderLive(stickerRows);

  const stampIds = [
    ...new Set([...stampsByDate.values()].flat().map((s) => s.image_id)),
  ];
  const stickerIds = [...new Set(stickers.map((s) => s.image_id))];

  const [aspects, stampBlobs, stickerBlobs] = await Promise.all([
    imageAspects([...new Set([...stampIds, ...stickerIds])]),
    resolveBlobs(stampIds, (r) => r.thumb, (img) => img.thumb_path),
    resolveBlobs(stickerIds, (r) => r.main, (img) => img.storage_path),
  ]);

  return { stampsByDate, stickers, aspects, stampBlobs, stickerBlobs };
}
