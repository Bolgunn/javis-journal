export type MaskType =
  | "postage"
  | "cloud"
  | "spiky"
  | "heart"
  | "circle"
  | "square"
  | "oval";

export type RotationDeg = 0 | 45 | 90 | 135 | 180 | 225 | 270 | 315;

/** The three real Pokémon frames — the keys of `FRAMES`, the ones with a spec and an asset. */
export type FrameId = "rse" | "hgss_15" | "hgss_18";

/**
 * What `profiles.selected_frame` holds: a frame, or `'none'` — she can wear no frame at all.
 *
 * The split from {@link FrameId} is load-bearing. `FRAMES` stays keyed on `FrameId`, so any code
 * that does `FRAMES[frame]` without first narrowing `'none'` away fails to compile — the compiler,
 * not a reviewer, is what makes every consumer handle the bare calendar.
 */
export type SelectedFrame = FrameId | "none";

export type AllowedEmail = {
  email: string;
  note: string | null;
  added_at: string;
};

export type Profile = {
  user_id: string;
  start_of_week: number;
  selected_frame: SelectedFrame;
  fireworks_seen: boolean;
  created_at: string;
  updated_at: string;
};

export type ImageRow = {
  id: string;
  user_id: string;
  storage_path: string;
  thumb_path: string;
  width: number | null;
  height: number | null;
  mime: string;
  byte_size: number | null;
  created_at: string;
};

export type Entry = {
  id: string;
  user_id: string;
  entry_date: string;
  created_at: string;
  updated_at: string;
};

export type Stamp = {
  id: string;
  entry_id: string;
  user_id: string;
  image_id: string;
  /** Which shape she cut. Metadata only — the crop is baked into the pixels (ADR-M5). */
  mask_type: MaskType;
  /** Stamp center, normalized to the 8:5 day page (0..1). */
  pos_x: number;
  pos_y: number;
  /** Stamp width as a fraction of the day page's width. */
  scale: number;
  rotation_deg: RotationDeg;
  layer_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/**
 * One entry in the (global) tray. A normal LWW table since M7: `updated_at` + `deleted_at` put
 * it on the same footing as every other synced table, so deleting a tray sticker is a soft
 * delete that propagates — and can't resurrect on the next pull. A `is_seeded` row can never be
 * tombstoned (the Postgres trigger enforces what the UI merely hides).
 */
export type StickerAsset = {
  id: string;
  user_id: string;
  image_id: string;
  is_seeded: boolean;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/**
 * A sticker stuck to ONE month's calendar (M7 reversal: month-bounded, not a global layer).
 *
 * `pos_x`/`pos_y` ∈ [0,1] are the sticker's CENTER as fractions of the **day-grid bounding box**
 * — the `7·cellW × 6·cellH` rect that exists identically in both calendar views — and `scale` is
 * its width ÷ the grid's width. That box is the only rect that survives a view switch, and it is
 * the rect M9's export rasterizes.
 */
export type PlacedSticker = {
  id: string;
  user_id: string;
  image_id: string;
  sticker_asset_id: string | null;
  /** The month this sticker lives on, `YYYY-MM`. It appears on no other month. */
  year_month: string;
  pos_x: number;
  pos_y: number;
  scale: number;
  rotation_deg: RotationDeg;
  layer_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};
