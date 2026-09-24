// M9-INSTAGRAM-PLAN decision 9: on a PR preview (which runs against production) every stamp and
// sticker write is refused — nothing lands in Dexie and nothing reaches the outbox — while the
// profile writes and the tray (the seeded-sticker upsert) keep working.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { db } from "@/lib/db";
import type { ImageRow, PlacedSticker, Stamp } from "@/lib/db/types";

vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  }),
}));
vi.mock("@/lib/sync/engine", () => ({
  markDirty: vi.fn(async () => {}),
  scheduleFlush: vi.fn(),
}));

import { markDirty } from "@/lib/sync/engine";
import { editingLocked } from "./preview-guard";
import {
  DayWriteError,
  addTrayAsset,
  createStampOnDay,
  deletePlacedSticker,
  deleteStamp,
  placeSticker,
  restorePlacedSticker,
  restoreStamp,
  setSelectedFrame,
  setStartOfWeek,
  updatePlacedSticker,
  updateStamp,
} from "./mutations";

const USER = "user-1";
const T0 = "2026-07-01T00:00:00.000Z";

const image: ImageRow = {
  id: "img1",
  user_id: USER,
  storage_path: "u/img1.png",
  thumb_path: "u/img1-t.jpg",
  width: 512,
  height: 512,
  mime: "image/png",
  byte_size: 1000,
  created_at: T0,
};

const stamp: Stamp = {
  id: "s1",
  entry_id: "e1",
  user_id: USER,
  image_id: "img1",
  mask_type: "circle",
  pos_x: 0.5,
  pos_y: 0.5,
  scale: 0.4,
  rotation_deg: 0,
  layer_order: 0,
  created_at: T0,
  updated_at: T0,
  deleted_at: null,
};

const sticker: PlacedSticker = {
  id: "k1",
  user_id: USER,
  image_id: "img1",
  sticker_asset_id: null,
  year_month: "2026-07",
  pos_x: 0.5,
  pos_y: 0.5,
  scale: 0.1,
  rotation_deg: 0,
  layer_order: 0,
  created_at: T0,
  updated_at: T0,
  deleted_at: null,
};

beforeEach(async () => {
  await db.open();
  await Promise.all([
    db.images.clear(),
    db.entries.clear(),
    db.stamps.clear(),
    db.placed_stickers.clear(),
    db.sticker_assets.clear(),
    db.profiles.clear(),
    db.sync_outbox.clear(),
  ]);
  await db.images.put(image);
  await db.entries.put({
    id: "e1",
    user_id: USER,
    entry_date: "2026-07-01",
    created_at: T0,
    updated_at: T0,
  });
  await db.stamps.put(stamp);
  await db.placed_stickers.put(sticker);
  vi.mocked(markDirty).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("on a Vercel preview", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
  });

  test("editing is locked", () => {
    expect(editingLocked()).toBe(true);
  });

  test("every stamp and sticker write refuses, and nothing is written or dirtied", async () => {
    await expect(createStampOnDay("2026-07-02", "img1", "circle")).rejects.toBeInstanceOf(
      DayWriteError,
    );
    await updateStamp("s1", { scale: 0.9 });
    expect(await deleteStamp("s1")).toBeNull();
    await restoreStamp("s1", 5);
    expect(await placeSticker("2026-07", "img1", null, { x: 0.5, y: 0.5 })).toBeNull();
    await updatePlacedSticker("k1", { scale: 0.2 });
    expect(await deletePlacedSticker("k1")).toBeNull();
    await restorePlacedSticker("k1", 5);

    expect(await db.stamps.toArray()).toEqual([stamp]);
    expect(await db.placed_stickers.toArray()).toEqual([sticker]);
    expect(await db.entries.count()).toBe(1);
    expect(await db.sync_outbox.count()).toBe(0);
  });

  test("profile writes still go through (frame, week start)", async () => {
    await setSelectedFrame("hgss_15");
    await setStartOfWeek(1);
    const profile = await db.profiles.get(USER);
    expect(profile?.selected_frame).toBe("hgss_15");
    expect(profile?.start_of_week).toBe(1);
    expect(markDirty).toHaveBeenCalledWith("profiles", USER, "upsert");
  });

  test("the tray (the seeded-sticker upsert) still writes", async () => {
    const asset = await addTrayAsset("img1", { id: "seed-1", isSeeded: true });
    expect(await db.sticker_assets.get(asset.id)).toBeTruthy();
  });
});

describe("anywhere else (production, local dev)", () => {
  test.each([undefined, "production", "development"])("NEXT_PUBLIC_VERCEL_ENV=%s writes", async (env) => {
    if (env !== undefined) vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", env);
    expect(editingLocked()).toBe(false);
    await updateStamp("s1", { scale: 0.3 });
    expect((await db.stamps.get("s1"))?.scale).toBe(0.3);
    expect(await deletePlacedSticker("k1")).toBe(0);
  });
});
