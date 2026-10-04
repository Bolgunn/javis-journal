// M11 DoD 3 — THE NO-NETWORK CANARY. The whole guest flow runs end to end against the real
// mutations, ingest, sync engine, display seam and export data path, with a Supabase client whose
// every method throws — and the test asserts the client factory was NEVER called. If a future
// change routes any guest path through Supabase, this goes red.
//
// Lowest seams used where the real thing needs a browser (stated so nothing is overclaimed):
//   • the image decoder (`@/lib/image/host` → processImage) is mocked: canvas decode is not
//     available in Node, and it never touched the network anyway;
//   • the stamp bake is given as a ready `BakeResult` (the cutter is canvas-only), and goes
//     through the real `ingestStamp` + `createStampOnDay`;
//   • the export runs the real `composeMonthPng` (Dexie read seam → plan → bitmap decode) with the
//     final canvas rasterizer (`renderExport`) mocked, and `createImageBitmap` stubbed;
//   • SyncBoot's effect is reproduced verbatim (isGuest → bootstrap, else startSyncLoop), plus a
//     direct `startSyncLoop()` to prove the engine's own guard.

import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

const supabase = vi.hoisted(() => ({ factoryCalls: 0, methodCalls: [] as string[] }));

// Every property of the client throws, and so does the factory: a single contact is a failure.
vi.mock("@/lib/supabase/browser", () => ({
  createClient: () => {
    supabase.factoryCalls += 1;
    return new Proxy(
      {},
      {
        get(_t, prop) {
          supabase.methodCalls.push(String(prop));
          throw new Error(`guest canary: Supabase client touched (.${String(prop)})`);
        },
      },
    );
  },
}));

vi.mock("@/lib/image/host", () => ({
  processImage: async (_file: File, kind: string) => ({
    mainBlob: new Blob([`main-${kind}`], { type: kind === "sticker" ? "image/png" : "image/jpeg" }),
    thumbBlob: new Blob([`thumb-${kind}`], { type: kind === "sticker" ? "image/png" : "image/jpeg" }),
    width: 800,
    height: 600,
  }),
}));

const rendered = vi.hoisted(() => ({ stamps: 0, stickers: 0 }));
vi.mock("@/lib/export/render", () => ({
  renderExport: async (_plan: unknown, bitmaps: { stamps: Map<string, unknown>; stickers: Map<string, unknown> }) => {
    rendered.stamps = bitmaps.stamps.size;
    rendered.stickers = bitmaps.stickers.size;
    const png = new Blob(["png"], { type: "image/png" });
    return { full: png, halves: [png, png] };
  },
}));

const DATE = "2026-10-11";
const YEAR = 2026;
const MONTH = 10;

// Filled in beforeAll, after the guest cookie is set and the module graph is fresh, so `@/lib/db`
// evaluates as a guest and opens "javis-journal-guest".
let m: {
  db: typeof import("@/lib/db").db;
  JournalDB: typeof import("@/lib/db").JournalDB;
  isGuest: typeof import("./identity").isGuest;
  GUEST_USER_ID: string;
  guestProfileBootstrap: typeof import("./guest-bootstrap").guestProfileBootstrap;
  engine: typeof import("@/lib/sync/engine");
  mutations: typeof import("@/lib/db/mutations");
  ingestImage: typeof import("@/lib/image/ingest").ingestImage;
  ingestStamp: typeof import("@/lib/stamp/ingest-stamp").ingestStamp;
  thumbs: typeof import("@/lib/image/thumb-url");
  seedStickers: typeof import("@/lib/sticker/seed").seedStickers;
  repairStickerThumbs: typeof import("@/lib/image/repair-sticker-thumbs").repairStickerThumbs;
  composeMonthPng: typeof import("@/lib/export/exportMonthPng").composeMonthPng;
};

const fetched: string[] = [];
const listeners: string[] = [];

beforeAll(async () => {
  vi.resetModules();
  vi.stubGlobal("document", {
    cookie: "jj_guest=1",
    visibilityState: "visible",
    addEventListener: (type: string) => listeners.push(type),
    removeEventListener: () => {},
    documentElement: {},
    fonts: { ready: Promise.resolve() },
  });
  vi.stubGlobal("window", { addEventListener: (type: string) => listeners.push(type) });
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  vi.stubGlobal("createImageBitmap", async () => ({ close() {} }));
  // Any fetch is recorded. Same-origin (`/frames/…`) is the export's own frame sheet; anything
  // else would be a network leak.
  vi.stubGlobal("fetch", async (url: string) => {
    fetched.push(String(url));
    return new Response(new Blob(["frame"]), { status: 200 });
  });

  m = {
    ...(await import("@/lib/db")),
    ...(await import("./identity")),
    ...(await import("./guest-bootstrap")),
    engine: await import("@/lib/sync/engine"),
    mutations: await import("@/lib/db/mutations"),
    ...(await import("@/lib/image/ingest")),
    ...(await import("@/lib/stamp/ingest-stamp")),
    thumbs: await import("@/lib/image/thumb-url"),
    ...(await import("@/lib/sticker/seed")),
    ...(await import("@/lib/image/repair-sticker-thumbs")),
    ...(await import("@/lib/export/exportMonthPng")),
  };
});

afterAll(() => {
  m.engine.__resetEngineForTests();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("guest mode never reaches Supabase", () => {
  test("the full guest flow runs, and the Supabase client is never built", async () => {
    const { db, engine, mutations } = m;

    // ---- Boot (SyncBoot's effect, verbatim) + the engine's own guard ----
    expect(m.isGuest()).toBe(true);
    expect(db.name).toBe("javis-journal-guest");
    const stopLoop = m.isGuest() ? (await m.guestProfileBootstrap(), () => {}) : engine.startSyncLoop();
    const stopDirect = engine.startSyncLoop();
    expect(listeners).toEqual([]); // no visibility/focus pull listeners were attached

    // The calendar's tray effect, for a guest: neither runs a write.
    await m.repairStickerThumbs();
    await m.seedStickers(m.GUEST_USER_ID);

    // ---- Profile: frame + week start ----
    await mutations.setSelectedFrame("hgss_15");
    await mutations.setStartOfWeek(0);

    // ---- A photo, cut into a stamp, placed on a day ----
    const photoId = await m.ingestImage(new File(["raw"], "photo.jpg", { type: "image/jpeg" }));
    const stampImageId = await m.ingestStamp({
      closeupBlob: new Blob(["closeup"], { type: "image/webp" }),
      thumbBlob: new Blob(["thumb"], { type: "image/webp" }),
      width: 600,
      height: 600,
      mime: "image/webp",
    });
    const stamp = await mutations.createStampOnDay(DATE, stampImageId, "circle");
    expect(stamp).not.toBeNull();

    // ---- Move / resize / rotate, delete, undo ----
    await mutations.updateStamp(stamp!.id, { pos_x: 0.3, scale: 0.5, rotation_deg: 45 });
    const priorLayer = await mutations.deleteStamp(stamp!.id);
    expect(priorLayer).not.toBeNull();
    await mutations.restoreStamp(stamp!.id, priorLayer!);

    // ---- A sticker: upload to the tray, place it, nudge it ----
    const stickerImageId = await m.ingestImage(
      new File(["png"], "sticker.png", { type: "image/png" }),
      "sticker",
    );
    const asset = await mutations.addTrayAsset(stickerImageId);
    const placed = await mutations.placeSticker("2026-10", stickerImageId, asset.id, {
      x: 0.5,
      y: 0.5,
    });
    expect(placed).not.toBeNull();
    await mutations.updatePlacedSticker(placed!.id, { scale: 0.2 });

    // ---- Display seam: thumbs + closeups, including a missing-blob fallback ----
    const thumbs = await m.thumbs.getThumbUrls([stampImageId, photoId]);
    expect(thumbs.size).toBe(2);
    for (const h of thumbs.values()) h.release();
    await db.image_blobs.delete(photoId); // a local miss would sign a URL for Javi
    expect(await m.thumbs.getThumbUrl(photoId)).toBeNull();
    expect(await m.thumbs.getCloseupUrl(photoId)).toBeNull();

    // ---- Export the viewed month ----
    const pngs = await m.composeMonthPng(YEAR, MONTH, 0, "hgss_15", true);
    expect(pngs.halves).toHaveLength(2);
    expect(rendered.stamps).toBe(1);
    expect(rendered.stickers).toBe(1);

    // ---- Let every timer the engine could have armed fire: debounce, backoff, pull interval ----
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    engine.scheduleFlush();
    await vi.advanceTimersByTimeAsync(800 + 1);
    await vi.advanceTimersByTimeAsync(3 * 60_000);
    await engine.flushNow();
    await engine.pullNow();
    vi.useRealTimers();
    stopLoop();
    stopDirect();

    // ======== The canary ========
    expect(supabase.factoryCalls).toBe(0);
    expect(supabase.methodCalls).toEqual([]);
    expect(fetched.every((url) => url.startsWith("/frames/"))).toBe(true);

    // Every row is the guest's, in the guest database.
    const owned = [
      ...(await db.entries.toArray()),
      ...(await db.stamps.toArray()),
      ...(await db.images.toArray()),
      ...(await db.placed_stickers.toArray()),
      ...(await db.sticker_assets.toArray()),
      ...(await db.profiles.toArray()),
    ];
    expect(owned.length).toBeGreaterThan(0);
    expect(new Set(owned.map((r) => r.user_id))).toEqual(new Set([m.GUEST_USER_ID]));
    const profile = await db.profiles.get(m.GUEST_USER_ID);
    expect(profile).toMatchObject({ selected_frame: "hgss_15", start_of_week: 0 });

    // The tray holds only what the guest uploaded — nothing was seeded.
    expect((await db.sticker_assets.toArray()).map((a) => a.image_id)).toEqual([stickerImageId]);

    // The outbox recorded everything (the write path is Javi's) and nothing drained it.
    const outbox = await db.sync_outbox.toArray();
    expect(outbox.length).toBeGreaterThan(0);
    expect(new Set(outbox.map((r) => r.table))).toEqual(
      new Set(["images", "entries", "stamps", "profiles", "placed_stickers", "sticker_assets"]),
    );

    // And Javi's database was never written.
    const javi = new m.JournalDB("javis-journal");
    await javi.open();
    const counts = await Promise.all(javi.tables.map((t) => t.count()));
    expect(counts.every((n) => n === 0)).toBe(true);
    javi.close();
  });
});
