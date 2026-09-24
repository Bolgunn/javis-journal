"use client";

import { useState } from "react";

import { db } from "@/lib/db";
import type { Entry, ImageRow, PlacedSticker, SelectedFrame, Stamp } from "@/lib/db/types";
import type { ImageBlobRow } from "@/lib/db/image-types";
import { FRAME_IDS, FRAMES } from "@/lib/frames/spec";
import { composeMonthPng } from "@/lib/export/exportMonthPng";
import { downloadBlob, exportFilename, shareBlob } from "@/lib/export/save";

const YEAR = 2026;
const MONTH = 7;
const WEEK_START = 1;

const PALETTE = ["#eaa9b8", "#b8dfd0", "#f6d186", "#a5c8e4", "#c9b6e4", "#f2a97c"];

/** A solid-ish stamp thumb: a rounded tile with a big initial, so composition is legible. */
function makeStampBlob(color: string, label: string): Promise<Blob> {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.font = "bold 140px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, size / 2, size / 2 + 8);
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}

/** A transparent sticker main: a filled circle with alpha corners (exercises the taint path). */
function makeStickerBlob(color: string): Promise<Blob> {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.font = "bold 180px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("★", size / 2, size / 2 + 12);
  return new Promise((res) => c.toBlob((b) => res(b!), "image/png"));
}

function imageRow(id: string, w: number, h: number, mime: string): ImageRow {
  return {
    id,
    user_id: "dev",
    storage_path: `dev/${id}.bin`,
    thumb_path: `dev/${id}_thumb.png`,
    width: w,
    height: h,
    mime,
    byte_size: 1000,
    created_at: "2026-07-01T00:00:00.000Z",
  };
}

function blobRow(id: string, over: Partial<ImageBlobRow>): ImageBlobRow {
  return {
    id,
    original: null,
    main: null,
    thumb: null,
    kind: "photo",
    createdAt: Date.now(),
    ...over,
  };
}

function entry(date: string): Entry {
  return {
    id: `dev-e-${date}`,
    user_id: "dev",
    entry_date: date,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
  };
}

function stamp(over: Partial<Stamp> & { id: string; entry_id: string; image_id: string }): Stamp {
  return {
    user_id: "dev",
    mask_type: "circle",
    pos_x: 0.5,
    pos_y: 0.5,
    scale: 0.5,
    rotation_deg: 0,
    layer_order: 0,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    deleted_at: null,
    ...over,
  };
}

function sticker(
  over: Partial<PlacedSticker> & { id: string; image_id: string },
): PlacedSticker {
  return {
    user_id: "dev",
    sticker_asset_id: "dev-a",
    year_month: "2026-07",
    pos_x: 0.4,
    pos_y: 0.4,
    scale: 0.18,
    rotation_deg: 0,
    layer_order: 0,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    deleted_at: null,
    ...over,
  };
}

/** Seed a decorated July 2026 into Dexie: several days of stamps + a scatter of stickers. */
async function seedDecorated() {
  await clearMonth();

  // Three stamp images.
  const stampImgs = ["dev-s0", "dev-s1", "dev-s2"];
  for (let i = 0; i < stampImgs.length; i++) {
    const blob = await makeStampBlob(PALETTE[i], String.fromCharCode(65 + i));
    await db.images.put(imageRow(stampImgs[i], 256, 256, "image/webp"));
    await db.image_blobs.put(blobRow(stampImgs[i], { thumb: blob, kind: "stamp" }));
  }

  // Two sticker images.
  const stickerImgs = ["dev-k0", "dev-k1"];
  for (let i = 0; i < stickerImgs.length; i++) {
    const blob = await makeStickerBlob(PALETTE[(i + 3) % PALETTE.length]);
    await db.images.put(imageRow(stickerImgs[i], 512, 512, "image/png"));
    await db.image_blobs.put(blobRow(stickerImgs[i], { main: blob, kind: "sticker" }));
  }

  // Stamps on a spread of days, some with multiple.
  const days = [4, 9, 14, 14, 20, 27];
  const entries = new Map<string, Entry>();
  const stamps: Stamp[] = [];
  days.forEach((d, i) => {
    const date = `2026-07-${String(d).padStart(2, "0")}`;
    if (!entries.has(date)) entries.set(date, entry(date));
    const nOnDay = stamps.filter((s) => s.entry_id === `dev-e-${date}`).length;
    stamps.push(
      stamp({
        id: `dev-st-${i}`,
        entry_id: `dev-e-${date}`,
        image_id: stampImgs[i % stampImgs.length],
        pos_x: 0.35 + 0.25 * nOnDay,
        pos_y: 0.45 + 0.1 * nOnDay,
        scale: 0.55 - 0.12 * nOnDay,
        rotation_deg: (nOnDay * 45) as Stamp["rotation_deg"],
        layer_order: nOnDay,
      }),
    );
  });
  await db.entries.bulkPut([...entries.values()]);
  await db.stamps.bulkPut(stamps);

  // A few stickers scattered over the grid.
  await db.placed_stickers.bulkPut([
    sticker({ id: "dev-pk0", image_id: stickerImgs[0], pos_x: 0.2, pos_y: 0.25, rotation_deg: 0 }),
    sticker({ id: "dev-pk1", image_id: stickerImgs[1], pos_x: 0.7, pos_y: 0.4, rotation_deg: 45 }),
    sticker({ id: "dev-pk2", image_id: stickerImgs[0], pos_x: 0.55, pos_y: 0.75, rotation_deg: 315 }),
  ]);
}

/** Clear only the rows this harness owns (leaves any real local data alone). */
async function clearMonth() {
  await db.stamps.where("id").startsWith("dev-").delete();
  await db.entries.where("id").startsWith("dev-e-").delete();
  await db.placed_stickers.where("id").startsWith("dev-pk").delete();
  await db.images.where("id").startsWith("dev-").delete();
  await db.image_blobs.where("id").startsWith("dev-").delete();
}

export function ExportHarness() {
  const [frame, setFrame] = useState<SelectedFrame>("rse");
  const [includeTitle, setIncludeTitle] = useState(true);
  const [src, setSrc] = useState<string | null>(null);
  const [dims, setDims] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const render = async () => {
    setBusy(true);
    setErr(null);
    try {
      const { full: blob } = await composeMonthPng(YEAR, MONTH, WEEK_START, frame, includeTitle);
      const bmp = await createImageBitmap(blob);
      setDims(`${bmp.width}×${bmp.height}px · ${(blob.size / 1024).toFixed(0)} KB`);
      bmp.close();
      setSrc((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-svh bg-page p-6 text-ink">
      <h1 className="font-title text-2xl">M9 — PNG export</h1>
      <p className="mt-1 text-sm text-muted">
        Seed a decorated July 2026, then render the real export pipeline. The image below is the
        actual PNG (empty month = seed nothing and render).
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <label className="text-sm font-semibold">
          Frame{" "}
          <select
            value={frame}
            onChange={(e) => setFrame(e.target.value as SelectedFrame)}
            className="rounded-control border border-line bg-paper px-2 py-1 text-sm"
          >
            {FRAME_IDS.map((id) => (
              <option key={id} value={id}>
                {FRAMES[id].label}
              </option>
            ))}
            <option value="none">None</option>
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm font-semibold">
          <input
            type="checkbox"
            checked={includeTitle}
            onChange={(e) => setIncludeTitle(e.target.checked)}
          />
          Title band
        </label>

        <button
          type="button"
          onClick={() => void seedDecorated().then(render)}
          disabled={busy}
          className="rounded-control bg-accent px-3 py-1.5 text-sm font-bold disabled:opacity-60"
        >
          Seed + render
        </button>
        <button
          type="button"
          onClick={() => void clearMonth().then(render)}
          disabled={busy}
          className="rounded-control border border-line px-3 py-1.5 text-sm font-bold disabled:opacity-60"
        >
          Clear + render (empty)
        </button>
        <button
          type="button"
          onClick={() => void render()}
          disabled={busy}
          className="rounded-control border border-line px-3 py-1.5 text-sm font-bold disabled:opacity-60"
        >
          Re-render
        </button>
        {/* The two real save paths, exercised independently — this is where the iOS
            download-vs-Save-to-Photos behaviour gets checked on the phone. */}
        <button
          type="button"
          onClick={() =>
            void composeMonthPng(YEAR, MONTH, WEEK_START, frame, includeTitle).then((b) =>
              shareBlob(b.full, exportFilename(YEAR, MONTH)),
            )
          }
          disabled={busy}
          className="rounded-control border border-line px-3 py-1.5 text-sm font-bold disabled:opacity-60"
        >
          Share (share sheet)
        </button>
        <button
          type="button"
          onClick={() =>
            void composeMonthPng(YEAR, MONTH, WEEK_START, frame, includeTitle).then((b) =>
              downloadBlob(b.full, exportFilename(YEAR, MONTH)),
            )
          }
          disabled={busy}
          className="rounded-control border border-line px-3 py-1.5 text-sm font-bold disabled:opacity-60"
        >
          Save (download)
        </button>
      </div>

      <p className="mt-3 text-xs text-muted">
        {busy ? "rendering…" : dims || "no render yet"}
        {err ? <span className="text-accent"> — {err}</span> : null}
      </p>

      {src ? (
        <div className="mt-4">
          <a href={src} download={`javis-journal-${YEAR}-07.png`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt="Exported month PNG"
              className="max-w-full rounded-card border border-line shadow-sm"
            />
          </a>
          <p className="mt-1 text-xs text-muted">Tap the image to download it.</p>
        </div>
      ) : null}
    </main>
  );
}
