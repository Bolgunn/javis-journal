"use client";

// M10 Tier-2 companion to the automated tour gate (US-13). NOT a shipped route.
//
// The tour.test.ts gate counts HANDLES in node — it proves the accounting (flat object-URL
// count, thumb-not-main). What node CANNOT see is real memory and real paint: whether the heap
// sawtooths back to baseline and whether scroll/pinch stay smooth over months of content. That
// is what this page is for. It seeds ~60 days across 3 months into the REAL <Calendar/>, and
// runs a scripted tour that churns BOTH read seams live (month thumbs via useMonthData + day
// closeups via useDayView) while showing a heap + live-URL readout. The owner watches Chrome
// DevTools on the Pixel 9: heap must sawtooth (return within ~10% of baseline after GC), FPS
// must stay smooth. See Wiki Javi's Journal/plans/M10-PLAN.md decision A.

import { useEffect, useMemo, useState } from "react";

import { Calendar } from "@/components/calendar/Calendar";
import { db } from "@/lib/db";
import type { Entry, ImageRow, Stamp } from "@/lib/db/types";
import type { ImageBlobRow } from "@/lib/db/image-types";
import { useDayView, useMonthData } from "@/lib/db/queries";
import { getLiveThumbUrlCount } from "@/lib/image/thumb-url";
import { addMonths, currentYearMonth, daysInMonth, isoDate } from "@/lib/calendar/month-grid";

const SEED_USER = "longrun-seed";
const MONTHS_BACK = 2; // current month + 2 prior ≈ 3 months / ~60 populated days
const TOUR_STEP_MS = 250;

async function makeBlob(hue: number, label: string, size: number): Promise<Blob> {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = `hsl(${hue} 60% 66%)`;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  ctx.font = `bold ${Math.round(size * 0.4)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, size / 2, size * 0.55);
  return new Promise<Blob>((resolve) => c.toBlob((b) => resolve(b!), "image/webp", 0.8));
}

async function seed(): Promise<void> {
  const now = new Date().toISOString();
  const cur = currentYearMonth();
  for (let back = 0; back <= MONTHS_BACK; back++) {
    const ym = addMonths(cur, -back);
    const dim = daysInMonth(ym.year, ym.month);
    for (let day = 1; day <= dim; day++) {
      if (day % 6 === 0) continue;
      const date = isoDate(ym.year, ym.month, day);
      const entry: Entry = {
        id: `longrun-e-${date}`,
        user_id: SEED_USER,
        entry_date: date,
        created_at: now,
        updated_at: now,
      };
      await db.entries.put(entry);
      const nStamps = (day % 3) + 1;
      for (let s = 0; s < nStamps; s++) {
        const imgId = `longrun-img-${date}-${s}`;
        // A real 256px thumb AND a real ~2048px main, so the day page's closeups exercise real
        // decode/heap (the whole point of the Tier-2 run) — not a shared tiny blob.
        const thumb = await makeBlob((day * 13 + s * 90) % 360, String(day), 256);
        const main = await makeBlob((day * 13 + s * 90) % 360, String(day), 2048);
        const image: ImageRow = {
          id: imgId,
          user_id: SEED_USER,
          storage_path: `longrun/${imgId}.webp`,
          thumb_path: `longrun/${imgId}_t.webp`,
          width: 2048,
          height: 2048,
          mime: "image/webp",
          byte_size: main.size,
          created_at: now,
        };
        const blob: ImageBlobRow = {
          id: imgId,
          original: null,
          main,
          thumb,
          kind: "stamp",
          createdAt: Date.now(),
        };
        const stamp: Stamp = {
          id: `longrun-s-${date}-${s}`,
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

async function clearSeed(): Promise<void> {
  for (const t of [db.entries, db.stamps, db.images] as const) {
    const keys = await t.filter((r) => String(r.id).startsWith("longrun-")).primaryKeys();
    await t.bulkDelete(keys as string[]);
  }
  const blobKeys = await db.image_blobs
    .filter((r) => r.id.startsWith("longrun-img-"))
    .primaryKeys();
  await db.image_blobs.bulkDelete(blobKeys as string[]);
}

export default function LongRunHarnessPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [touring, setTouring] = useState(false);

  async function run(label: string, fn: () => Promise<void>) {
    setBusy(label);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <Calendar />

      <div className="fixed bottom-3 left-3 z-[60] w-72 rounded-card border border-line bg-paper/95 p-3 text-xs text-ink shadow-lg backdrop-blur">
        <p className="mb-2 font-title text-sm font-semibold">M10 long-run harness</p>

        <div className="mb-2 flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run("seed", seed)}
            className="rounded-control border border-line bg-accent-soft px-2 py-1 font-bold disabled:opacity-50"
          >
            {busy === "seed" ? "Seeding…" : "Seed ~60 days"}
          </button>
          <button
            type="button"
            disabled={busy !== null}
            onClick={() => run("clear", clearSeed)}
            className="rounded-control border border-line px-2 py-1 font-bold disabled:opacity-50"
          >
            Clear
          </button>
        </div>

        <Readout />

        <label className="mt-2 flex items-center gap-2">
          <input type="checkbox" checked={touring} onChange={(e) => setTouring(e.target.checked)} />
          Auto-tour (churn month + day seams)
        </label>
        {touring ? <TourProbe /> : null}

        <p className="mt-2 text-[0.7rem] leading-snug text-muted">
          Seed, then watch heap in DevTools: it must sawtooth back to ~baseline after GC, and
          the live-URL count must stay flat. Scroll/pinch should stay smooth over all 3 months.
        </p>
      </div>
    </>
  );
}

/** Live object-URL count + JS heap (Chrome only), the two numbers the Tier-2 gate turns on. */
function Readout() {
  const [urls, setUrls] = useState(0);
  const [peakUrls, setPeakUrls] = useState(0);
  const [heapMb, setHeapMb] = useState<number | null>(null);
  const [peakHeapMb, setPeakHeapMb] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      const c = getLiveThumbUrlCount();
      setUrls(c);
      setPeakUrls((p) => Math.max(p, c));
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory;
      if (mem) {
        const mb = mem.usedJSHeapSize / (1024 * 1024);
        setHeapMb(mb);
        setPeakHeapMb((p) => Math.max(p, mb));
      }
    }, 250);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="font-mono leading-relaxed">
      <p>
        live object-URLs: <span className="font-bold">{urls}</span>{" "}
        <span className="text-muted">(peak {peakUrls})</span>
      </p>
      <p>
        heap:{" "}
        {heapMb === null ? (
          <span className="text-muted">n/a (Chrome only)</span>
        ) : (
          <>
            <span className="font-bold">{heapMb.toFixed(1)} MB</span>{" "}
            <span className="text-muted">(peak {peakHeapMb.toFixed(1)})</span>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * Churns BOTH read seams live: a mounted month-data consumer AND a mounted day-view consumer,
 * each keyed so every tick forces unmount → remount across the seeded range. If either seam
 * stops releasing on unmount, the live-URL count (and heap) climb instead of holding flat.
 */
function TourProbe() {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => s + 1), TOUR_STEP_MS);
    return () => clearInterval(id);
  }, []);

  const cur = currentYearMonth();
  const ym = addMonths(cur, -(step % (MONTHS_BACK + 1)));
  const day = (step % 26) + 1; // 1..26 (skip past the % 6 empties safely enough)
  const date = isoDate(ym.year, ym.month, day);

  return (
    <>
      <MonthProbe key={`m-${ym.year}-${ym.month}`} year={ym.year} month={ym.month} />
      <DayProbe key={`d-${date}`} date={date} />
    </>
  );
}

function MonthProbe({ year, month }: { year: number; month: number }) {
  const data = useMonthData(year, month);
  const withThumb = useMemo(
    () => [...data.values()].filter((d) => d.stamps.length > 0).length,
    [data],
  );
  return (
    <p className="mt-1 font-mono text-[0.7rem] text-muted">
      month {year}-{String(month).padStart(2, "0")}: {data.size} days / {withThumb} thumbs
    </p>
  );
}

function DayProbe({ date }: { date: string }) {
  const view = useDayView(date);
  return (
    <p className="font-mono text-[0.7rem] text-muted">
      day {date}: {view.stamps.length} stamps / {view.urls.size} closeups
    </p>
  );
}
