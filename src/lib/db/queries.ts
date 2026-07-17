// The ONLY place UI components read Dexie. Mirrors how thumb-url.ts is the sole
// image-read seam. Everything here is a reactive hook (dexie-react-hooks
// `useLiveQuery`) so a sync pull or a day edit re-renders the calendar for free.
// Writes live in ./mutations.ts and go through the M2 outbox.
"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";

import { db } from "@/lib/db";
import type {
  PlacedSticker,
  Profile,
  SelectedFrame,
  Stamp,
  StickerAsset,
} from "@/lib/db/types";
import { DEFAULT_FRAME } from "@/lib/frames/spec";
import {
  getCloseupUrls,
  getThumbUrls,
  type ThumbHandle,
} from "@/lib/image/thumb-url";
import { monthRange, yearMonthKey } from "@/lib/calendar/month-grid";

/**
 * One day's content for the grid: **all** its live stamps (M6 — the cell renders the day's
 * faithful mini-composition through the same `stampBoxes` the day page uses, not one
 * cover-filled thumb). `urls`/`aspects` are the month-wide maps, shared by reference.
 */
export type DayData = {
  date: string;
  /** Live stamps for the day, ordered by `layer_order` (back to front). */
  stamps: Stamp[];
  /** image_id → resolved 256px thumb URL (month-wide, shared). */
  urls: Map<string, string>;
  /** image_id → baked aspect (width / height) (month-wide, shared). */
  aspects: Map<string, number>;
};

/** Live stamps of a day, back-to-front. Ties on id so Dexie's array order can't leak through. */
function orderStamps(stamps: Stamp[]): Stamp[] {
  return stamps
    .filter((s) => s.deleted_at == null)
    .sort((a, b) => a.layer_order - b.layer_order || (a.id < b.id ? -1 : 1));
}

type MonthStamps = {
  byDate: Map<string, Stamp[]>;
  /** Every distinct image_id in the month, and its baked aspect. */
  aspects: Map<string, number>;
};

const EMPTY_MONTH: MonthStamps = { byDate: new Map(), aspects: new Map() };

/**
 * The pure month loader — one month's live stamps by date + their baked aspects. Extracted from
 * the `useMonthData` hook so the M10 long-run harness can drive the **real** read path (not a
 * copy) with no React runtime; the hook is a thin `useLiveQuery` wrapper around it.
 */
export async function loadMonthStamps(year: number, month: number): Promise<MonthStamps> {
  const { start, endExclusive } = monthRange(year, month);

  const entries = await db.entries
    .where("entry_date")
    .between(start, endExclusive, true, false)
    .toArray();
  if (entries.length === 0) return EMPTY_MONTH;

  const dateByEntryId = new Map(entries.map((e) => [e.id, e.entry_date]));
  const stamps = await db.stamps
    .where("entry_id")
    .anyOf([...dateByEntryId.keys()])
    .toArray();

  const byEntry = new Map<string, Stamp[]>();
  for (const s of stamps) {
    const list = byEntry.get(s.entry_id);
    if (list) list.push(s);
    else byEntry.set(s.entry_id, [s]);
  }

  const byDate = new Map<string, Stamp[]>();
  for (const [entryId, list] of byEntry) {
    const date = dateByEntryId.get(entryId);
    const live = orderStamps(list);
    if (date && live.length > 0) byDate.set(date, live);
  }

  const aspects = await imageAspects(
    [...new Set([...byDate.values()].flat().map((s) => s.image_id))],
  );
  return { byDate, aspects };
}

/**
 * Reactive read of one month's day content, keyed by `YYYY-MM-DD`. Range-scans `entries` for
 * the month, collects each day's live stamps, and batch-resolves every stamp image's thumb in a
 * single `getThumbUrls` round-trip (≤ 3 × 31 ids — still one call, still 256px thumbs). Every
 * `ThumbHandle` is released when the month unmounts or its stamp set changes (ALG-6, the freeze
 * fix).
 */
export function useMonthData(year: number, month: number): Map<string, DayData> {
  const monthStamps = useLiveQuery(
    () => loadMonthStamps(year, month),
    [year, month],
    EMPTY_MONTH,
  );

  const urls = useImageUrls(
    useMemo(
      () => [...new Set([...monthStamps.byDate.values()].flat().map((s) => s.image_id))],
      [monthStamps],
    ),
    getThumbUrls,
  );

  return useMemo(() => {
    const out = new Map<string, DayData>();
    for (const [date, stamps] of monthStamps.byDate) {
      out.set(date, { date, stamps, urls, aspects: monthStamps.aspects });
    }
    return out;
  }, [monthStamps, urls]);
}

/** One open day: its live stamps + their **2048px closeups**, released when the day closes. */
export type DayView = {
  stamps: Stamp[];
  /** image_id → closeup URL. */
  urls: Map<string, string>;
  /** image_id → baked aspect (width / height). */
  aspects: Map<string, number>;
};

const EMPTY_DAY: DayView = { stamps: [], urls: new Map(), aspects: new Map() };

/**
 * The pure day loader — one day's live stamps + their baked aspects (no URLs; the hook resolves
 * closeups). Extracted from `useDayView` so the M10 long-run harness drives the real read path.
 */
export async function loadDayStamps(date: string | null): Promise<DayView> {
  if (!date) return EMPTY_DAY;
  const entry = await db.entries.where("entry_date").equals(date).first();
  if (!entry) return EMPTY_DAY;

  const stamps = orderStamps(
    await db.stamps.where("entry_id").equals(entry.id).toArray(),
  );
  if (stamps.length === 0) return EMPTY_DAY;

  const aspects = await imageAspects([...new Set(stamps.map((s) => s.image_id))]);
  return { stamps, urls: new Map(), aspects };
}

/**
 * Reactive read of the open day page. Resolves closeups (not thumbs) — this is the one screen
 * that shows a stamp at full size — and releases every object URL when the overlay unmounts.
 * `date === null` (no day open) resolves nothing and holds nothing.
 */
export function useDayView(date: string | null): DayView {
  const query = useLiveQuery(() => loadDayStamps(date), [date], EMPTY_DAY);

  const urls = useImageUrls(
    useMemo(() => [...new Set(query.stamps.map((s) => s.image_id))], [query]),
    getCloseupUrls,
  );

  return useMemo(
    () => ({ stamps: query.stamps, urls, aspects: query.aspects }),
    [query, urls],
  );
}

/** One month's sticker layer: its live stickers + the thumbs they draw from. */
export type MonthStickers = {
  /** Live stickers on this month, back-to-front. */
  stickers: PlacedSticker[];
  /** image_id → resolved 256px thumb URL. */
  urls: Map<string, string>;
  /** image_id → aspect (width / height). */
  aspects: Map<string, number>;
};

const EMPTY_STICKERS: { stickers: PlacedSticker[]; aspects: Map<string, number> } = {
  stickers: [],
  aspects: new Map(),
};

/**
 * Reactive read of ONE month's stickers (M7 — stickers are month-bounded, so this is the whole
 * layer). Range-scans the `year_month` index, resolves every distinct sticker image's **256px
 * thumb** in one round-trip, and releases every handle when the month unmounts (ALG-6).
 *
 * Thumbs, not closeups: the sticker layer *is* the month grid, and an uploaded sticker can be a
 * 2048px alpha PNG — twenty of those held live is exactly the freeze this rule exists to prevent
 * (`MAX_SCALE` bounds how soft that can look). The **one open knob** in M7: if a real phone says
 * they look mushy, swap `getThumbUrls` → `getCloseupUrls` on the line below and nothing else.
 *
 * Object URLs are deduped per `image_id` inside `getThumbUrls`, so 40 stickers stamped from 5
 * tray assets hold 5 object URLs — the canary asserts exactly that.
 */
export function useMonthStickers(year: number, month: number): MonthStickers {
  const ym = yearMonthKey(year, month);

  const query = useLiveQuery(
    async () => {
      const rows = await db.placed_stickers.where("year_month").equals(ym).toArray();
      const stickers = orderStickers(rows);
      if (stickers.length === 0) return EMPTY_STICKERS;

      const aspects = await imageAspects([
        ...new Set(stickers.map((s) => s.image_id)),
      ]);
      return { stickers, aspects };
    },
    [ym],
    EMPTY_STICKERS,
  );

  const urls = useImageUrls(
    useMemo(() => [...new Set(query.stickers.map((s) => s.image_id))], [query]),
    getThumbUrls,
  );

  return useMemo(
    () => ({ stickers: query.stickers, urls, aspects: query.aspects }),
    [query, urls],
  );
}

/** The (global) tray: her sticker assets + their thumbs. */
export type TrayView = {
  /** Live tray assets, newest last (the order she added them). */
  assets: StickerAsset[];
  urls: Map<string, string>;
  aspects: Map<string, number>;
  /** False only during the very first (undefined) live-query tick — the tray's empty state. */
  loaded: boolean;
};

const EMPTY_TRAY: { assets: StickerAsset[]; aspects: Map<string, number> } = {
  assets: [],
  aspects: new Map(),
};

/**
 * Reactive read of the tray. The tray is **global** — she uploads a sticker once and can stamp
 * it onto any month — so this is not month-scoped. Thumbs, released when the sheet unmounts.
 */
export function useTray(): TrayView {
  const query = useLiveQuery(async () => {
    const rows = await db.sticker_assets.toArray();
    const assets = rows
      .filter((a) => a.deleted_at == null)
      .sort((a, b) => (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1));
    const aspects = await imageAspects([...new Set(assets.map((a) => a.image_id))]);
    return { assets, aspects };
  }, []);

  const assets = query?.assets ?? EMPTY_TRAY.assets;
  const urls = useImageUrls(
    useMemo(() => [...new Set(assets.map((a) => a.image_id))], [assets]),
    getThumbUrls,
  );

  return useMemo(
    () => ({
      assets,
      urls,
      aspects: query?.aspects ?? EMPTY_TRAY.aspects,
      loaded: query !== undefined,
    }),
    [assets, urls, query],
  );
}

/** Live stickers, back-to-front. Ties on id so Dexie's array order can't leak through. */
function orderStickers(stickers: PlacedSticker[]): PlacedSticker[] {
  return stickers
    .filter((s) => s.deleted_at == null)
    .sort((a, b) => a.layer_order - b.layer_order || (a.id < b.id ? -1 : 1));
}

/** image_id → baked aspect, from the local `images` rows. Missing dims simply don't appear. */
async function imageAspects(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (ids.length === 0) return out;
  const rows = await db.images.bulkGet(ids);
  for (const row of rows) {
    if (row?.width && row.height) out.set(row.id, row.width / row.height);
  }
  return out;
}

/**
 * Resolve a set of image ids to URLs through the image seam, holding the handles and
 * **releasing every one of them** on unmount or whenever the id set changes. This is ALG-6 —
 * the fix for the ~20-day freeze — and it is why the object-URL canary stays flat.
 */
function useImageUrls(
  ids: string[],
  resolve: (ids: string[]) => Promise<Map<string, ThumbHandle>>,
): Map<string, string> {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  const handlesRef = useRef<ThumbHandle[]>([]);
  const key = ids.join(",");

  useEffect(() => {
    let cancelled = false;

    void resolve(key === "" ? [] : key.split(",")).then((handleMap) => {
      if (cancelled) {
        for (const h of handleMap.values()) h.release();
        return;
      }
      for (const h of handlesRef.current) h.release();
      handlesRef.current = [...handleMap.values()];

      const next = new Map<string, string>();
      for (const [id, handle] of handleMap) next.set(id, handle.url);
      setUrls(next);
    });

    return () => {
      cancelled = true;
    };
    // `key` is the id set; `resolve` is a module-level function (stable).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  // Release everything on unmount (the load-bearing ALG-6 obligation).
  useEffect(
    () => () => {
      for (const h of handlesRef.current) h.release();
      handlesRef.current = [];
    },
    [],
  );

  return urls;
}

/** Normalized view of the local profile row for calendar chrome. */
export type ProfileView = {
  /** ISO week-start (1 = Mon … 7 = Sun). Defaults to 1 (Mon) until a row exists. */
  startOfWeek: number;
  /** M8: the chosen Pokémon frame. Defaults to the column's own default until a row exists. */
  selectedFrame: SelectedFrame;
  /** The row's user_id, or null before the first pull writes a profile row. */
  userId: string | null;
  /** False only during the very first (undefined) live-query tick. */
  loaded: boolean;
};

/**
 * Reactive read of the local profile row, defaulting `start_of_week = 1` (Mon) and the frame to
 * `rse` when no row exists yet (first load before pull). Re-fires when sync writes the profile —
 * which is how a frame chosen on her phone lands on the laptop.
 */
export function useProfile(): ProfileView {
  const row = useLiveQuery<Profile | undefined>(
    () => db.profiles.toCollection().first(),
    [],
  );

  return {
    startOfWeek: row?.start_of_week ?? 1,
    selectedFrame: row?.selected_frame ?? DEFAULT_FRAME,
    userId: row?.user_id ?? null,
    loaded: row !== undefined,
  };
}
