// M11 Task 3 — for a guest the sync transport is off and every identity call site resolves to
// GUEST_USER_ID without asking Supabase (M11-PLAN decisions 5, 6, 7). The client factory throws
// on contact, so any call that slipped through fails loudly.

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const supabase = vi.hoisted(() => ({ calls: 0 }));
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => {
    supabase.calls += 1;
    throw new Error("guest mode must never build a Supabase client");
  },
}));

// The pipeline needs a real browser decoder; the identity under test does not.
vi.mock("@/lib/image/host", () => ({
  processImage: async () => ({
    mainBlob: new Blob(["main"], { type: "image/jpeg" }),
    thumbBlob: new Blob(["thumb"], { type: "image/jpeg" }),
    width: 800,
    height: 600,
  }),
}));

import { db } from "@/lib/db";
import { editingLocked } from "@/lib/db/preview-guard";
import { setSelectedFrame, setStartOfWeek } from "@/lib/db/mutations";
import { ingestImage } from "@/lib/image/ingest";
import { repairStickerThumbs } from "@/lib/image/repair-sticker-thumbs";
import { getCloseupUrl, getThumbUrl, getThumbUrls } from "@/lib/image/thumb-url";
import { loadExportData } from "@/lib/export/data";
import { ingestStamp } from "@/lib/stamp/ingest-stamp";
import { seedStickers } from "@/lib/sticker/seed";
import {
  __resetEngineForTests,
  flushNow,
  markDirty,
  pullNow,
  startSyncLoop,
} from "@/lib/sync/engine";
import { GUEST_USER_ID } from "./identity";

// Fake only the engine's clocks: fake-indexeddb schedules its own work on setImmediate.
function fakeTimers() {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
}

function enterGuestMode() {
  const listeners = vi.fn();
  vi.stubGlobal("document", {
    cookie: "jj_guest=1",
    visibilityState: "visible",
    addEventListener: listeners,
    removeEventListener: vi.fn(),
  });
  return listeners;
}

beforeEach(async () => {
  supabase.calls = 0;
  __resetEngineForTests();
  await db.open();
  await Promise.all(db.tables.map((t) => t.clear()));
  enterGuestMode();
});

afterEach(() => {
  __resetEngineForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the sync transport is off", () => {
  test("startSyncLoop is a no-op: no pull, no listeners, no interval", () => {
    fakeTimers();
    const listeners = enterGuestMode();
    const stop = startSyncLoop();
    vi.advanceTimersByTime(5 * 60_000);
    stop();
    expect(listeners).not.toHaveBeenCalled();
    expect(supabase.calls).toBe(0);
  });

  test("flushNow and pullNow do nothing — and arm no backoff retry", async () => {
    fakeTimers();
    await flushNow();
    await pullNow();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(supabase.calls).toBe(0);
  });

  test("markDirty still writes the outbox; the debounced flush never drains it", async () => {
    fakeTimers();
    await markDirty("entries", "e1", "upsert");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await db.sync_outbox.count()).toBe(1);
    expect(supabase.calls).toBe(0);
  });
});

describe("identity call sites resolve to the guest", () => {
  test("ingestImage writes the image row as the guest", async () => {
    const id = await ingestImage(new File(["x"], "a.jpg", { type: "image/jpeg" }));
    const row = await db.images.get(id);
    expect(row?.user_id).toBe(GUEST_USER_ID);
    expect(row?.storage_path.startsWith(`${GUEST_USER_ID}/`)).toBe(true);
    expect(supabase.calls).toBe(0);
  });

  test("ingestStamp writes the baked stamp as the guest", async () => {
    const id = await ingestStamp({
      closeupBlob: new Blob(["c"], { type: "image/webp" }),
      thumbBlob: new Blob(["t"], { type: "image/webp" }),
      width: 512,
      height: 512,
      mime: "image/webp",
    } as Parameters<typeof ingestStamp>[0]);
    expect((await db.images.get(id))?.user_id).toBe(GUEST_USER_ID);
    expect(supabase.calls).toBe(0);
  });

  test("the profile fallback (no row yet) is the guest, not a Supabase lookup", async () => {
    await setStartOfWeek(0);
    await db.profiles.clear();
    await setSelectedFrame("hgss_15");
    expect((await db.profiles.toArray()).map((p) => p.user_id)).toEqual([GUEST_USER_ID]);
    expect(supabase.calls).toBe(0);
  });
});

describe("no remote fallback for images", () => {
  test("a missing local blob resolves to nothing, without signing a URL", async () => {
    await db.images.put({
      id: "img-missing",
      user_id: GUEST_USER_ID,
      storage_path: "guest/photo/img-missing.jpg",
      thumb_path: "guest/photo/img-missing-thumb.jpg",
      width: 1,
      height: 1,
      mime: "image/jpeg",
      byte_size: 1,
      created_at: "2026-10-01T00:00:00.000Z",
    });
    expect(await getThumbUrl("img-missing")).toBeNull();
    expect(await getCloseupUrl("img-missing")).toBeNull();
    expect((await getThumbUrls(["img-missing"])).size).toBe(0);
    expect(supabase.calls).toBe(0);
  });

  test("the export skips a missing image instead of signing it", async () => {
    const data = await loadExportData(2026, 10);
    expect(data.stampBlobs.size).toBe(0);
    expect(supabase.calls).toBe(0);
  });
});

describe("no sticker seeding or repair for a guest (decision 6)", () => {
  test("seedStickers and repairStickerThumbs write nothing", async () => {
    await repairStickerThumbs();
    await seedStickers(GUEST_USER_ID);
    expect(await db.sticker_assets.count()).toBe(0);
    expect(await db.images.count()).toBe(0);
    expect(await db.sync_outbox.count()).toBe(0);
  });
});

describe("the preview guard (decision 7)", () => {
  test("a guest on a preview is not locked; a signed-in user still is", () => {
    vi.stubEnv("NEXT_PUBLIC_VERCEL_ENV", "preview");
    expect(editingLocked()).toBe(false);
    vi.stubGlobal("document", { cookie: "" });
    expect(editingLocked()).toBe(true);
  });
});
