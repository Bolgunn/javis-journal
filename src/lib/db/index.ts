import Dexie, { type Table } from "dexie";

import { JOURNAL_DB_NAME, journalDbName } from "@/lib/auth/identity";

import type {
  Entry,
  ImageRow,
  PlacedSticker,
  Profile,
  Stamp,
  StickerAsset,
} from "./types";
import type { ImageBlobRow } from "./image-types";
import type { SyncMetaRow, SyncOutboxRow } from "./sync-types";

export class JournalDB extends Dexie {
  entries!: Table<Entry, string>;
  stamps!: Table<Stamp, string>;
  placed_stickers!: Table<PlacedSticker, string>;
  profiles!: Table<Profile, string>;
  images!: Table<ImageRow, string>;
  image_blobs!: Table<ImageBlobRow, string>;
  sticker_assets!: Table<StickerAsset, string>;
  sync_outbox!: Table<SyncOutboxRow, string>;
  sync_meta!: Table<SyncMetaRow, string>;

  // M11: the IndexedDB name is an argument — guests live in their own database (see `db` below).
  constructor(name: string = JOURNAL_DB_NAME) {
    super(name);

    this.version(1).stores({
      entries: "id",
      stamps: "id, entry_id",
      placed_stickers: "id",
      profiles: "user_id",
      images: "id",
      sticker_assets: "id",
      sync_outbox: "id, [table+rowId]",
      sync_meta: "table",
    });

    // v2: additive image_blobs store (device-local, never synced).
    // createdAt is indexed for the original-eviction scan.
    this.version(2).stores({
      image_blobs: "id, createdAt",
    });

    // v3 (M4): additive entry_date index on entries so the calendar can range-scan
    // a month (entries.where('entry_date').between(...)). Index only, no data change.
    // ⚠ Coordinate this version number with M5 at merge — one milestone takes v3,
    // the other v4; the migrations are additive and independent.
    this.version(3).stores({
      entries: "id, entry_date",
    });

    // v4 (M6): the `Stamp` type loses crop_offset_x/crop_offset_y/crop_scale (the crop is
    // baked into the pixels — ADR-M5; the matching Postgres migration drops the columns).
    // No index or data change: M6 is the first writer of `stamps`, so no rows exist. The
    // bump exists so a device that somehow holds a pre-M6 row upgrades cleanly.
    this.version(4).stores({});

    // v5 (M7): stickers are MONTH-BOUNDED (M7-PLAN decision 2), so `placed_stickers` gains a
    // `year_month` index the sticker layer range-scans, exactly as `entries.entry_date` backs
    // the calendar's month read. Additive index only — M7 is the first writer, no rows exist.
    this.version(5).stores({
      placed_stickers: "id, year_month",
    });
  }
}

// Chosen ONCE, at module load (M11-PLAN decision 2): a guest gets "javis-journal-guest", everyone
// else "javis-journal". Every guest <-> signed-in switch is a full navigation, so this never has to
// change mid-session, and none of the importers of `db` learn that guest mode exists.
export const db = new JournalDB(journalDbName());
