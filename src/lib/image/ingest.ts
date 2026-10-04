// Ingest a picked file into the local-first store: process -> write blobs + images
// row -> mark dirty for upload. Fail-closed: a pipeline error writes nothing.

import { db } from "@/lib/db";
import type { ImageBlobRow } from "@/lib/db/image-types";
import type { ImageRow } from "@/lib/db/types";
import { scheduleFlush } from "@/lib/sync/engine";
import { markDirty } from "@/lib/sync/outbox";
import { GUEST_USER_ID, isGuest } from "@/lib/auth/identity";
import { createClient } from "@/lib/supabase/browser";
import { processImage } from "./host";
import { ImagePipelineError, type ProcessKind } from "./process";
import { mainPath, thumbPath } from "./storage-paths";

// Dedupe a concurrent double-pick of the SAME File object (double-tap / duplicate
// change events). Content dedupe across separate picks is intentionally deferred.
const inFlight = new Map<File, Promise<string>>();

/**
 * Ingest a picked file; resolves with the image id.
 *
 * `id` is supplied only by the sticker seeder (M7), which needs **deterministic** ids so a
 * second device seeding the same sticker writes the same primary key — an upsert, not a
 * duplicate. Every other caller lets one be minted.
 */
export function ingestImage(
  file: File,
  kind: ProcessKind = "photo",
  options: { id?: string } = {},
): Promise<string> {
  const existing = inFlight.get(file);
  if (existing) return existing;

  const run = doIngest(file, kind, options.id).finally(() => inFlight.delete(file));
  inFlight.set(file, run);
  return run;
}

async function doIngest(file: File, kind: ProcessKind, forcedId?: string): Promise<string> {
  // Fail-closed: never write partial state on a decode/transcode failure.
  let processed;
  try {
    processed = await processImage(file, kind);
  } catch (err) {
    if (err instanceof ImagePipelineError) throw err;
    throw new ImagePipelineError("Ingest failed during image processing", { cause: err });
  }

  const uid = await currentUserId();
  const id = forcedId ?? crypto.randomUUID();

  const blobRow: ImageBlobRow = {
    id,
    original: file,
    main: processed.mainBlob,
    thumb: processed.thumbBlob,
    kind,
    createdAt: Date.now(),
  };

  const imageRow: ImageRow = {
    id,
    user_id: uid,
    storage_path: mainPath(uid, id, kind),
    thumb_path: thumbPath(uid, id, kind),
    width: processed.width,
    height: processed.height,
    mime: kind === "sticker" ? "image/png" : "image/jpeg",
    byte_size: processed.mainBlob.size,
    created_at: new Date().toISOString(),
  };

  // Blobs, row, and the outbox 'upload' marker land atomically.
  await db.transaction("rw", db.image_blobs, db.images, db.sync_outbox, async () => {
    await db.image_blobs.put(blobRow);
    await db.images.put(imageRow);
    await markDirty("images", id, "upload");
  });

  // Arm the debounced flush so the upload actually happens. outbox.markDirty only
  // records the row; the engine owns scheduling (startSyncLoop only pulls).
  scheduleFlush();

  return id;
}

async function currentUserId(): Promise<string> {
  // M11: a guest has no session — the identity is the cookie, and nothing ever asks Supabase.
  if (isGuest()) return GUEST_USER_ID;
  const supabase = createClient();
  // getSession reads the locally-stored session (no network) so ingest works offline.
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new ImagePipelineError("Cannot ingest image without a session", { cause: error });
  }
  const uid = data.session?.user.id;
  if (!uid) {
    throw new ImagePipelineError("Cannot ingest image without a signed-in user");
  }
  return uid;
}
