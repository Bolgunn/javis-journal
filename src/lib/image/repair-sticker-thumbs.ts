// One-shot repair for stickers ingested before the alpha fix.
//
// The bug: `processImage` encoded EVERY thumb as JPEG. JPEG has no alpha channel, so a
// sticker's transparent pixels composited to **black** — and since the sticker layer renders
// from 256px thumbs (M7 decision 15), every placed sticker showed up as a black box. Photos were
// unaffected (no alpha to lose) and so were stamps (the day page draws their WebP closeups).
//
// Fixing the encoder only fixes stickers ingested from now on. The ones already on her device —
// the 3 seeded ones, and anything she uploaded — still hold a JPEG thumb locally AND have
// uploaded one to Storage. So: re-encode the thumb from the local `main` (which is a correct
// alpha PNG), point the `images` row at the new `.png` thumb path, and mark it dirty so push
// replaces the object in Storage too (uploads are idempotent — deterministic paths + upsert).
//
// Safe to run on every boot: a sticker whose thumb is already PNG costs one indexed read.

import { isGuest } from "@/lib/auth/identity";
import { db } from "@/lib/db";
import { scheduleFlush } from "@/lib/sync/engine";
import { markDirty } from "@/lib/sync/outbox";
import { processImage } from "./host";
import { thumbPath } from "./storage-paths";

let inFlight: Promise<void> | null = null;

export function repairStickerThumbs(): Promise<void> {
  if (isGuest()) return Promise.resolve(); // M11 decision 6: nothing to repair for a guest
  if (!inFlight) {
    inFlight = run().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function run(): Promise<void> {
  const stale = await db.image_blobs
    .filter(
      (row) =>
        row.kind === "sticker" &&
        row.main != null &&
        row.thumb != null &&
        row.thumb.type !== "image/png",
    )
    .toArray();

  for (const row of stale) {
    try {
      const image = await db.images.get(row.id);
      if (!image || !row.main) continue;

      // Re-run the (now-fixed) pipeline over the alpha PNG we already hold locally.
      const file = new File([row.main], `${row.id}.png`, { type: "image/png" });
      const processed = await processImage(file, "sticker");

      await db.transaction("rw", db.image_blobs, db.images, db.sync_outbox, async () => {
        await db.image_blobs.update(row.id, { thumb: processed.thumbBlob });
        await db.images.put({
          ...image,
          thumb_path: thumbPath(image.user_id, image.id, "sticker"),
          mime: "image/png",
        });
        // Re-upload: the Storage object still holds the black JPEG, and a second device would
        // otherwise pull it.
        await markDirty("images", image.id, "upload");
      });
    } catch {
      // Best-effort: a failed repair leaves the (wrong but working) thumb in place and retries
      // on the next boot. It must never keep her out of her calendar.
    }
  }

  if (stale.length > 0) scheduleFlush();
}
