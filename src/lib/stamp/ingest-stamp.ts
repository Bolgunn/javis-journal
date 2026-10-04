// Persist a baked stamp through the M3 image layer (decision 7): mint an id, write the
// image_blobs (kind:'stamp', original:null, closeup as `main`, thumb) + the images row +
// an ('images', id, 'upload') outbox marker atomically, then schedule a flush. Mirrors
// ingestImage minus the source blob. Fail-closed: an incomplete bake writes nothing.

import { db } from "@/lib/db";
import type { ImageBlobRow } from "@/lib/db/image-types";
import type { ImageRow } from "@/lib/db/types";
import { ImagePipelineError } from "@/lib/image/process";
import { stampMainPath, stampThumbPath } from "@/lib/image/storage-paths";
import { GUEST_USER_ID, isGuest } from "@/lib/auth/identity";
import { createClient } from "@/lib/supabase/browser";
import { scheduleFlush } from "@/lib/sync/engine";
import { markDirty } from "@/lib/sync/outbox";
import type { BakeResult } from "./bake";

/** Ingest a baked stamp; resolves with the minted image id (the cutter's onConfirm value). */
export async function ingestStamp(bake: BakeResult): Promise<string> {
  if (!bake || !bake.closeupBlob || !bake.thumbBlob) {
    throw new ImagePipelineError("ingestStamp: incomplete bake result");
  }

  const uid = await currentUserId();
  const id = crypto.randomUUID();

  const blobRow: ImageBlobRow = {
    id,
    original: null, // the raw photo is transient (ADR-M5) — never retained for a stamp
    main: bake.closeupBlob, // the baked closeup is the "main"
    thumb: bake.thumbBlob,
    kind: "stamp",
    createdAt: Date.now(),
  };

  const imageRow: ImageRow = {
    id,
    user_id: uid,
    storage_path: stampMainPath(uid, id, bake.mime),
    thumb_path: stampThumbPath(uid, id, bake.mime),
    width: bake.width,
    height: bake.height,
    mime: bake.mime,
    byte_size: bake.closeupBlob.size,
    created_at: new Date().toISOString(),
  };

  // Blobs, row, and the outbox 'upload' marker land atomically (mirrors ingestImage).
  await db.transaction("rw", db.image_blobs, db.images, db.sync_outbox, async () => {
    await db.image_blobs.put(blobRow);
    await db.images.put(imageRow);
    await markDirty("images", id, "upload");
  });

  // Arm the debounced flush so the existing images-branch of flush() uploads the webp blobs.
  scheduleFlush();

  return id;
}

async function currentUserId(): Promise<string> {
  // M11: a guest has no session — the identity is the cookie, and nothing ever asks Supabase.
  if (isGuest()) return GUEST_USER_ID;
  const supabase = createClient();
  // getSession reads the locally-stored session (no network) so a cut works offline.
  const { data, error } = await supabase.auth.getSession();
  if (error) {
    throw new ImagePipelineError("Cannot ingest a stamp without a session", { cause: error });
  }
  const uid = data.session?.user.id;
  if (!uid) {
    throw new ImagePipelineError("Cannot ingest a stamp without a signed-in user");
  }
  return uid;
}
