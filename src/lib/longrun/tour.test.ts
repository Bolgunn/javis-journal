// M10 Tier-1 hard gate (US-13) — the whole-app long-run canary.
//
// The freeze the app exists to avoid is an EMERGENT, cross-surface property: months churn,
// day pages open over them, the stamper decodes a full-res bitmap — and if any one surface
// stops releasing what it holds, the heap climbs until the ~20-day freeze. The per-surface
// canaries (thumb-url, day, sticker) each localize ONE surface; this harness sits above them
// and drives a scripted 30–60 "day" tour of the REAL read seams (loadMonthStamps / loadDayStamps
// + getThumbUrls / getCloseupUrls) together, asserting the accounting that actually causes the
// freeze — there is no real decode/heap in node, so we count HANDLES, not bytes (Tier-2 on the
// Pixel 9 owns real memory). Two invariants beyond flatness:
//   • the grid resolves the `thumb` blob, the day page the `main` blob — a tag mismatch is the
//     freeze bug in miniature (the grid holding 2048px mains is exactly ALG-6's target);
//   • the live object-URL count returns to baseline after every surface closes and never grows
//     across the tour (release-on-unmount holds).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { db } from "@/lib/db";
import type { Entry, ImageRow, Stamp } from "@/lib/db/types";
import type { ImageBlobRow } from "@/lib/db/image-types";
import { loadDayStamps, loadMonthStamps } from "@/lib/db/queries";
import { addMonths, daysInMonth, isoDate } from "@/lib/calendar/month-grid";
import { createMockSupabase } from "@/lib/sync/test-utils";
import {
  __resetThumbUrlCacheForTests,
  getCloseupUrls,
  getLiveThumbUrlCount,
  getThumbUrls,
} from "@/lib/image/thumb-url";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/browser", () => ({ createClient: () => holder.client }));

const SEED_USER = "tour-seed";
const START = { year: 2026, month: 5 }; // 3 seeded months: 2026-05, -06, -07
const MONTHS = [START, addMonths(START, 1), addMonths(START, 2)];

// Tag every blob by SIZE — the createObjectURL shim must prove which blob (thumb vs main) each
// resolved URL was minted from, but Dexie structured-clones blobs on the round-trip (WeakMap
// identity is lost) and the shim is synchronous (can't await blob.text()). Size survives the
// clone and is readable synchronously: a 1-byte thumb, a 2-byte main.
const THUMB_BYTES = 1;
const MAIN_BYTES = 2;
const urlTag = new Map<string, "thumb" | "main">();
let urlSeq = 0;

function tagged(tag: "thumb" | "main"): Blob {
  const n = tag === "thumb" ? THUMB_BYTES : MAIN_BYTES;
  return new Blob(["x".repeat(n)], { type: "image/webp" });
}

function tagOf(b: Blob): "thumb" | "main" {
  return b.size === THUMB_BYTES ? "thumb" : "main";
}

const urlShim = URL as unknown as {
  createObjectURL: (b: Blob) => string;
  revokeObjectURL: (u: string) => void;
};

/** Every seeded day carries 1–3 stamps; each image_blobs row holds BOTH a tagged thumb and a
 *  tagged main, so a grid path that wrongly reads `main` would be caught by the tag assertion. */
async function seed(): Promise<void> {
  const now = new Date().toISOString();
  for (const ym of MONTHS) {
    const dim = daysInMonth(ym.year, ym.month);
    for (let day = 1; day <= dim; day++) {
      if (day % 7 === 0) continue; // a few empty days per month
      const date = isoDate(ym.year, ym.month, day);
      const entry: Entry = {
        id: `tour-e-${date}`,
        user_id: SEED_USER,
        entry_date: date,
        created_at: now,
        updated_at: now,
      };
      await db.entries.put(entry);

      const nStamps = (day % 3) + 1; // 1..3
      for (let s = 0; s < nStamps; s++) {
        const imgId = `tour-img-${date}-${s}`;
        const image: ImageRow = {
          id: imgId,
          user_id: SEED_USER,
          storage_path: `tour/${imgId}.webp`,
          thumb_path: `tour/${imgId}_t.webp`,
          width: 200,
          height: 200,
          mime: "image/webp",
          byte_size: 1000,
          created_at: now,
        };
        const blob: ImageBlobRow = {
          id: imgId,
          original: null,
          main: tagged("main"),
          thumb: tagged("thumb"),
          kind: "stamp",
          createdAt: Date.now(),
        };
        const stamp: Stamp = {
          id: `tour-s-${date}-${s}`,
          entry_id: entry.id,
          user_id: SEED_USER,
          image_id: imgId,
          mask_type: "circle",
          pos_x: 0.5,
          pos_y: 0.5,
          scale: 0.7,
          rotation_deg: 0,
          layer_order: s,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        };
        await db.images.put(image);
        await db.image_blobs.put(blob);
        await db.stamps.put(stamp);
      }
    }
  }
}

beforeEach(async () => {
  holder.client = createMockSupabase().client;
  urlSeq = 0;
  urlTag.clear();
  urlShim.createObjectURL = (b: Blob) => {
    const url = `blob:tour/${++urlSeq}`;
    urlTag.set(url, tagOf(b));
    return url;
  };
  urlShim.revokeObjectURL = () => {};
  await db.open();
  await Promise.all([db.entries.clear(), db.stamps.clear(), db.images.clear(), db.image_blobs.clear()]);
  __resetThumbUrlCacheForTests();
  await seed();
});

afterEach(() => {
  __resetThumbUrlCacheForTests();
  vi.restoreAllMocks();
});

/** Distinct stamp image ids in one seeded month (the month grid's live-URL working set). */
async function monthImageCount(year: number, month: number): Promise<number> {
  const { byDate } = await loadMonthStamps(year, month);
  return new Set([...byDate.values()].flat().map((s) => s.image_id)).size;
}

describe("long-run whole-app tour", () => {
  it("holds a flat object-URL count and a bounded working set across a 45-day tour", async () => {
    const TOUR_DAYS = 45;
    // The peak the tour is allowed to reach: one month's grid thumbs held while a day overlay
    // (≤ 3 closeups) sits open above it. Nothing may exceed this — a leak would grow past it.
    const monthCounts = await Promise.all(MONTHS.map((m) => monthImageCount(m.year, m.month)));
    const cap = Math.max(...monthCounts) + 3;

    expect(getLiveThumbUrlCount()).toBe(0);
    let peak = 0;

    for (let step = 0; step < TOUR_DAYS; step++) {
      const ym = MONTHS[step % MONTHS.length];

      // Mount the month grid: resolve every distinct thumb, exactly as useMonthData does.
      const month = await loadMonthStamps(ym.year, ym.month);
      const monthIds = [...new Set([...month.byDate.values()].flat().map((s) => s.image_id))];
      const monthHandles = await getThumbUrls(monthIds);
      // INVARIANT: the grid draws from the `thumb` blob, never `main`.
      for (const h of monthHandles.values()) {
        expect(urlTag.get(h.url)).toBe("thumb");
      }

      // Open a day page OVER the still-mounted month: resolve its closeups (the `main` blobs).
      const dates = [...month.byDate.keys()].sort();
      const date = dates[step % dates.length];
      const day = await loadDayStamps(date);
      const dayIds = [...new Set(day.stamps.map((s) => s.image_id))];
      const dayHandles = await getCloseupUrls(dayIds);
      // INVARIANT: the day page draws from the `main` closeup, never the thumb.
      for (const h of dayHandles.values()) {
        expect(urlTag.get(h.url)).toBe("main");
      }

      peak = Math.max(peak, getLiveThumbUrlCount());
      expect(getLiveThumbUrlCount()).toBeLessThanOrEqual(cap);

      // Close the day, then the month (unmount = release every handle).
      for (const h of dayHandles.values()) h.release();
      for (const h of monthHandles.values()) h.release();

      // Back to baseline after every "day" — the release-on-unmount obligation.
      expect(getLiveThumbUrlCount()).toBe(0);
    }

    expect(peak).toBeGreaterThan(0); // the tour actually held something
    expect(peak).toBeLessThanOrEqual(cap); // …but never more than one month + one open day
    expect(getLiveThumbUrlCount()).toBe(0); // …and leaked nothing at the end
  });

  it("resolves distinct images once per month regardless of how many stamps share them", async () => {
    // Dedupe holds: N stamps referencing the same image → one object URL (getThumbUrls dedupes).
    const ym = MONTHS[0];
    const month = await loadMonthStamps(ym.year, ym.month);
    const ids = [...new Set([...month.byDate.values()].flat().map((s) => s.image_id))];
    const handles = await getThumbUrls(ids);
    expect(getLiveThumbUrlCount()).toBe(ids.length);
    expect(handles.size).toBe(ids.length);
    for (const h of handles.values()) h.release();
    expect(getLiveThumbUrlCount()).toBe(0);
  });
});
