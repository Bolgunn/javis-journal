// The calendar's only write path. Mirrors the read seam (queries.ts): components
// never touch Dexie or Supabase directly. Writes go local-first + through the M2
// outbox (`markDirty` schedules the debounced flush); the sync engine pushes them.
//
// On a PR preview every stamp and sticker write is refused (`editingLocked`, see
// preview-guard.ts): the preview runs against production and pushes whole rows.
"use client";

import { db } from "@/lib/db";
import { EDITING_LOCKED_NOTE, editingLocked } from "@/lib/db/preview-guard";
import type {
  Entry,
  MaskType,
  PlacedSticker,
  Profile,
  SelectedFrame,
  Stamp,
  StickerAsset,
} from "@/lib/db/types";
import { placeStamp } from "@/lib/day/place";
import type { Point } from "@/lib/gestures/machine";
import { placeSticker as placeStickerAt } from "@/lib/sticker/place";
import { createClient } from "@/lib/supabase/browser";
import { markDirty, scheduleFlush } from "@/lib/sync/engine";
import { markDirty as outboxMarkDirty } from "@/lib/sync/outbox";

/**
 * Persist the week-start preference (US-4). Updates the local `profiles` row with a
 * fresh client `updated_at`, then marks it dirty so the M2 engine syncs it. When no
 * local profile exists yet (rare — the first pull creates one), a minimal row is
 * synthesized against the signed-in user.
 */
export async function setStartOfWeek(startOfWeek: number): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.profiles.toCollection().first();

  let userId = existing?.user_id;
  if (!userId) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Cannot set week-start without a signed-in user.");
    userId = user.id;
  }

  const row: Profile = existing
    ? { ...existing, start_of_week: startOfWeek, updated_at: now }
    : {
        user_id: userId,
        start_of_week: startOfWeek,
        selected_frame: "rse",
        fireworks_seen: false,
        created_at: now,
        updated_at: now,
      };

  await db.profiles.put(row);
  await markDirty("profiles", userId, "upsert");
}

/**
 * Persist the chosen Pokémon frame (US-10). The same shape as {@link setStartOfWeek}: local
 * write with a fresh client `updated_at`, then `markDirty` — the M2 engine debounces the push,
 * LWW resolves it, and the frame lands on her other device. Optimistic by construction: the
 * calendar re-frames off the local row the instant it is written, with no round-trip.
 */
export async function setSelectedFrame(frame: SelectedFrame): Promise<void> {
  const now = new Date().toISOString();
  const existing = await db.profiles.toCollection().first();

  // Idempotent: re-tapping the swatch she is already wearing must not dirty the row. The menu's
  // re-tap gesture means "take it off" for a frame, and simply nothing for `'none'`.
  if (existing?.selected_frame === frame) return;

  let userId = existing?.user_id;
  if (!userId) {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw new Error("Cannot set the frame without a signed-in user.");
    userId = user.id;
  }

  const row: Profile = existing
    ? { ...existing, selected_frame: frame, updated_at: now }
    : {
        user_id: userId,
        start_of_week: 1,
        selected_frame: frame,
        fireworks_seen: false,
        created_at: now,
        updated_at: now,
      };

  await db.profiles.put(row);
  await markDirty("profiles", userId, "upsert");
}

/** A day's write failed and nothing was written (fail-closed). */
export class DayWriteError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DayWriteError";
  }
}

/**
 * Place a freshly cut stamp on a day (US-7, US-8) — **the first writer of `entries`/`stamps`**.
 *
 * The `entries` row is created lazily and **atomically with the first `stamps` row**: one Dexie
 * transaction writes both rows and both outbox markers, so an abandoned pick or a failed bake
 * leaves no orphan entry behind. (`push.ts` already flushes `entries` before `stamps`, so the
 * server-side FK holds.) Returns null when the day is already at the 3-cap — nothing is written.
 *
 * Fail-closed: a missing/blank image row throws `DayWriteError` before any write happens.
 */
export async function createStampOnDay(
  date: string,
  imageId: string,
  maskType: MaskType,
): Promise<Stamp | null> {
  // Previews never write stamps (decision 9). Thrown, not a silent null: the Stamper shows it.
  if (editingLocked()) throw new DayWriteError(EDITING_LOCKED_NOTE);
  // Read the baked image OUTSIDE the transaction: it gives us both the aspect that ALG-8 needs
  // and the owning user_id (so a cut works offline, with no auth round-trip).
  const image = await db.images.get(imageId);
  if (!image) {
    throw new DayWriteError(`Cannot place a stamp: image ${imageId} is not on this device.`);
  }
  if (!image.width || !image.height) {
    throw new DayWriteError(`Cannot place a stamp: image ${imageId} has no dimensions.`);
  }
  const aspect = image.width / image.height;
  const userId = image.user_id;
  const now = new Date().toISOString();

  return db.transaction(
    "rw",
    db.entries,
    db.stamps,
    db.sync_outbox,
    async (): Promise<Stamp | null> => {
      let entry = await db.entries.where("entry_date").equals(date).first();
      const existing = entry
        ? await db.stamps.where("entry_id").equals(entry.id).toArray()
        : [];

      const placement = placeStamp(existing, aspect);
      if (!placement) return null; // 3-cap — write nothing.

      let entryCreated = false;
      if (!entry) {
        entry = {
          id: crypto.randomUUID(),
          user_id: userId,
          entry_date: date,
          created_at: now,
          updated_at: now,
        } satisfies Entry;
        entryCreated = true;
      }

      const stamp: Stamp = {
        id: crypto.randomUUID(),
        entry_id: entry.id,
        user_id: userId,
        image_id: imageId,
        mask_type: maskType,
        ...placement,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };

      if (entryCreated) {
        await db.entries.put(entry);
        await outboxMarkDirty("entries", entry.id, "upsert");
      }
      await db.stamps.put(stamp);
      await outboxMarkDirty("stamps", stamp.id, "upsert");

      return stamp;
    },
  ).then((stamp) => {
    // Arm the debounced push only once the transaction has committed.
    if (stamp) scheduleFlush();
    return stamp;
  });
}

/** The transform / layer fields a gesture may write. Everything else is derived or immutable. */
export type StampPatch = Partial<
  Pick<Stamp, "pos_x" | "pos_y" | "scale" | "rotation_deg" | "layer_order">
>;

/**
 * Commit one gesture (ALG-9): a drag, a pinch/twist, or a front/back tap. Called **once, on
 * gesture-end** — never per animation frame. Bumps `updated_at` so LWW resolves it everywhere.
 */
export async function updateStamp(id: string, patch: StampPatch): Promise<void> {
  if (editingLocked()) return;
  const now = new Date().toISOString();
  await db.transaction("rw", db.stamps, db.sync_outbox, async () => {
    const row = await db.stamps.get(id);
    if (!row) return;
    await db.stamps.put({ ...row, ...patch, updated_at: now });
    await outboxMarkDirty("stamps", id, "upsert");
  });
  scheduleFlush();
}

/**
 * Optimistic soft-delete: set the tombstone + mark dirty immediately (a deferred write would
 * invent an undurable state that a tab-kill could silently resurrect). Returns the stamp's
 * `layer_order` so Undo can restore it **in place** rather than to the top. The `entries` row
 * survives an empty day — the calendar filters tombstones, so the day just renders empty.
 */
export async function deleteStamp(id: string): Promise<number | null> {
  if (editingLocked()) return null;
  const now = new Date().toISOString();
  const layerOrder = await db.transaction(
    "rw",
    db.stamps,
    db.sync_outbox,
    async (): Promise<number | null> => {
      const row = await db.stamps.get(id);
      if (!row || row.deleted_at != null) return null;
      await db.stamps.put({ ...row, deleted_at: now, updated_at: now });
      await outboxMarkDirty("stamps", id, "upsert");
      return row.layer_order;
    },
  );
  if (layerOrder !== null) scheduleFlush();
  return layerOrder;
}

/**
 * Undo a delete: clear the tombstone with a **newer** `updated_at` (so it wins by LWW on every
 * device) and restore the original `layer_order` — the stamp comes back exactly where it was.
 */
export async function restoreStamp(id: string, layerOrder: number): Promise<void> {
  if (editingLocked()) return;
  const now = new Date().toISOString();
  await db.transaction("rw", db.stamps, db.sync_outbox, async () => {
    const row = await db.stamps.get(id);
    if (!row) return;
    await db.stamps.put({
      ...row,
      deleted_at: null,
      layer_order: layerOrder,
      updated_at: now,
    });
    await outboxMarkDirty("stamps", id, "upsert");
  });
  scheduleFlush();
}

// ---- Stickers (M7, US-9) ------------------------------------------------------------------
//
// Two tables, two lifetimes: `sticker_assets` is the GLOBAL tray (upload once, stamp anywhere);
// `placed_stickers` are instances stuck to ONE month (`year_month`). Every write here is a
// single write, on commit, through `markDirty` — the same discipline as the stamps above.

/**
 * Stamp a tray sticker onto a month (US-9). `wanted` is the desired center in normalized grid
 * coords — the layer passes the center of the *visible* part of the grid, so a tap while scrolled
 * to the far column doesn't drop the sticker off-screen. Cascades off anything already there.
 *
 * Returns null at the 50-per-month cap (nothing is written). Fail-closed: a missing/dimensionless
 * image row throws before any write.
 */
export async function placeSticker(
  yearMonth: string,
  imageId: string,
  stickerAssetId: string | null,
  wanted: Point,
): Promise<PlacedSticker | null> {
  if (editingLocked()) return null; // previews never write stickers (decision 9)
  const image = await db.images.get(imageId);
  if (!image) {
    throw new DayWriteError(`Cannot place a sticker: image ${imageId} is not on this device.`);
  }
  if (!image.width || !image.height) {
    throw new DayWriteError(`Cannot place a sticker: image ${imageId} has no dimensions.`);
  }
  const aspect = image.width / image.height;
  const userId = image.user_id;
  const now = new Date().toISOString();

  const sticker = await db.transaction(
    "rw",
    db.placed_stickers,
    db.sync_outbox,
    async (): Promise<PlacedSticker | null> => {
      const existing = await db.placed_stickers
        .where("year_month")
        .equals(yearMonth)
        .toArray();

      const placement = placeStickerAt(existing, aspect, wanted);
      if (!placement) return null; // the 50-cap — write nothing.

      const row: PlacedSticker = {
        id: crypto.randomUUID(),
        user_id: userId,
        image_id: imageId,
        sticker_asset_id: stickerAssetId,
        year_month: yearMonth,
        ...placement,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      };

      await db.placed_stickers.put(row);
      await outboxMarkDirty("placed_stickers", row.id, "upsert");
      return row;
    },
  );

  if (sticker) scheduleFlush();
  return sticker;
}

/** The transform / layer fields a sticker gesture may write. */
export type StickerPatch = Partial<
  Pick<PlacedSticker, "pos_x" | "pos_y" | "scale" | "rotation_deg" | "layer_order">
>;

/** Commit one sticker gesture — once, on gesture-end. Never per animation frame. */
export async function updatePlacedSticker(id: string, patch: StickerPatch): Promise<void> {
  if (editingLocked()) return;
  const now = new Date().toISOString();
  await db.transaction("rw", db.placed_stickers, db.sync_outbox, async () => {
    const row = await db.placed_stickers.get(id);
    if (!row) return;
    await db.placed_stickers.put({ ...row, ...patch, updated_at: now });
    await outboxMarkDirty("placed_stickers", id, "upsert");
  });
  scheduleFlush();
}

/**
 * Optimistic soft-delete of a placed sticker; returns its `layer_order` so Undo restores it **in
 * place** rather than to the top. (Deleting a placed instance never touches the tray.)
 */
export async function deletePlacedSticker(id: string): Promise<number | null> {
  if (editingLocked()) return null;
  const now = new Date().toISOString();
  const layerOrder = await db.transaction(
    "rw",
    db.placed_stickers,
    db.sync_outbox,
    async (): Promise<number | null> => {
      const row = await db.placed_stickers.get(id);
      if (!row || row.deleted_at != null) return null;
      await db.placed_stickers.put({ ...row, deleted_at: now, updated_at: now });
      await outboxMarkDirty("placed_stickers", id, "upsert");
      return row.layer_order;
    },
  );
  if (layerOrder !== null) scheduleFlush();
  return layerOrder;
}

/** Undo: clear the tombstone with a NEWER `updated_at` (so it wins by LWW) at its old layer. */
export async function restorePlacedSticker(id: string, layerOrder: number): Promise<void> {
  if (editingLocked()) return;
  const now = new Date().toISOString();
  await db.transaction("rw", db.placed_stickers, db.sync_outbox, async () => {
    const row = await db.placed_stickers.get(id);
    if (!row) return;
    await db.placed_stickers.put({
      ...row,
      deleted_at: null,
      layer_order: layerOrder,
      updated_at: now,
    });
    await outboxMarkDirty("placed_stickers", id, "upsert");
  });
  scheduleFlush();
}

/**
 * Add an ingested image to the (global) tray. `id` is passed in only by the seeder, which needs
 * **deterministic** ids so two devices seeding the same sticker upsert one row instead of two;
 * an upload just mints one.
 */
export async function addTrayAsset(
  imageId: string,
  options: { id?: string; isSeeded?: boolean } = {},
): Promise<StickerAsset> {
  const image = await db.images.get(imageId);
  if (!image) {
    throw new DayWriteError(`Cannot add to the tray: image ${imageId} is not on this device.`);
  }
  const now = new Date().toISOString();

  const asset: StickerAsset = {
    id: options.id ?? crypto.randomUUID(),
    user_id: image.user_id,
    image_id: imageId,
    is_seeded: options.isSeeded ?? false,
    created_at: now,
    updated_at: now,
    deleted_at: null,
  };

  await db.transaction("rw", db.sticker_assets, db.sync_outbox, async () => {
    await db.sticker_assets.put(asset);
    await outboxMarkDirty("sticker_assets", asset.id, "upsert");
  });
  scheduleFlush();
  return asset;
}

/**
 * Remove an uploaded sticker from the tray — a **soft** delete, so it propagates by LWW and
 * cannot resurrect on the next pull. A **seeded** asset is refused here and refused again by the
 * Postgres trigger (the UI hides the affordance; the DB makes it impossible). Already-placed
 * instances are untouched: they render from their own `image_id`.
 *
 * Returns false when nothing was written (seeded, missing, or already deleted).
 */
export async function deleteTrayAsset(id: string): Promise<boolean> {
  const now = new Date().toISOString();
  const deleted = await db.transaction(
    "rw",
    db.sticker_assets,
    db.sync_outbox,
    async (): Promise<boolean> => {
      const row = await db.sticker_assets.get(id);
      if (!row || row.is_seeded || row.deleted_at != null) return false;
      await db.sticker_assets.put({ ...row, deleted_at: now, updated_at: now });
      await outboxMarkDirty("sticker_assets", id, "upsert");
      return true;
    },
  );
  if (deleted) scheduleFlush();
  return deleted;
}

/** Undo a tray deletion (the same toast the day page uses). */
export async function restoreTrayAsset(id: string): Promise<void> {
  const now = new Date().toISOString();
  await db.transaction("rw", db.sticker_assets, db.sync_outbox, async () => {
    const row = await db.sticker_assets.get(id);
    if (!row) return;
    await db.sticker_assets.put({ ...row, deleted_at: null, updated_at: now });
    await outboxMarkDirty("sticker_assets", id, "upsert");
  });
  scheduleFlush();
}
