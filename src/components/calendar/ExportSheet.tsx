"use client";

// M9 — the export bottom sheet (US-12). Same overlay posture as the M7 sticker tray / the
// calendar menu: a sheet over the calendar so she keeps seeing the month she is saving. One
// choice (include the month/year title band, default ON — a per-export taste, not worth a
// persisted profile field) and TWO downloads of the same 2160×1350 Instagram post
// (M9-INSTAGRAM-PLAN decision 7):
//   • Full image (left, secondary): the whole post, one file.
//   • 2 halves   (right, primary):  the two 1080×1350 carousel slides, left then right — what she
//     actually posts; swiped, they join back into the one wide month.
// Both are plain `<a download>`s; there is no share sheet any more.
//
// ONE DOWNLOAD PER TAP: iPhone Safari keeps only the last of two downloads fired from one tap (the
// second replaced the first — found on Tier-2). So "2 halves" downloads the LEFT half, holds the
// right one, and becomes "Download 2nd half"; the second tap saves it with no re-compose. Changing
// the title toggle or taking the full image drops the held half (it would no longer match).
//
// Async states: one shared lock (`preparing`) disables both while either works; the tapped button
// shows "Preparing…". On success the sheet closes; a failure keeps it open with an inline message.

import { useEffect, useState } from "react";

import type { SelectedFrame } from "@/lib/db/types";
import { composeMonthPng } from "@/lib/export/exportMonthPng";
import { downloadBlob, exportFilename } from "@/lib/export/save";

type Preparing = "full" | "halves" | null;

export function ExportSheet({
  year,
  month,
  weekStart,
  frame,
  onClose,
}: {
  /** The VIEWED month — Calendar's `{year, month}` state, never `todayISO()`. */
  year: number;
  month: number;
  weekStart: number;
  frame: SelectedFrame;
  onClose: () => void;
}) {
  const [includeTitle, setIncludeTitle] = useState(true);
  const [preparing, setPreparing] = useState<Preparing>(null);
  const [failed, setFailed] = useState(false);
  /** The right half, composed with the left and waiting for its own tap (see the header). */
  const [secondHalf, setSecondHalf] = useState<Blob | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const busy = preparing !== null;

  /** Compose once per tap (the title toggle affects the output, so we never cache), then save. */
  const run = async (which: "full" | "halves") => {
    if (busy) return;
    // The held right half is saved straight from this tap — no compose, nothing to wait on.
    if (which === "halves" && secondHalf) {
      downloadBlob(secondHalf, exportFilename(year, month, 2));
      setSecondHalf(null);
      onClose();
      return;
    }
    setPreparing(which);
    setFailed(false);
    setSecondHalf(null);
    try {
      const pngs = await composeMonthPng(year, month, weekStart, frame, includeTitle);
      if (which === "full") {
        downloadBlob(pngs.full, exportFilename(year, month));
        onClose();
      } else {
        downloadBlob(pngs.halves[0], exportFilename(year, month, 1));
        setSecondHalf(pngs.halves[1]);
        setPreparing(null);
      }
    } catch {
      setPreparing(null);
      setFailed(true);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col justify-end bg-ink/40"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="rounded-t-cell bg-paper px-4 pb-6 pt-3 shadow-sm"
        role="dialog"
        aria-label="Download month as image"
      >
        <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-line" aria-hidden />

        <h2 className="mb-3 text-center font-title text-lg text-ink">Download this month</h2>

        <button
          type="button"
          role="switch"
          aria-checked={includeTitle}
          disabled={busy}
          onClick={() => {
            setIncludeTitle((v) => !v);
            setSecondHalf(null);
          }}
          className="flex w-full items-center justify-between rounded-control border border-line px-4 py-3 text-left text-sm font-semibold text-ink disabled:opacity-60"
        >
          <span>Include the month title</span>
          <span
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              includeTitle ? "bg-accent" : "bg-line"
            }`}
            aria-hidden
          >
            <span
              className={`absolute top-0.5 size-5 rounded-full bg-paper transition-all ${
                includeTitle ? "left-[1.375rem]" : "left-0.5"
              }`}
            />
          </span>
        </button>

        {failed ? (
          <p className="mt-3 text-center text-sm text-accent">
            Couldn&apos;t create the image — try again.
          </p>
        ) : null}

        {secondHalf ? (
          <p className="mt-3 text-center text-sm text-ink">
            1st half saved — tap again for the 2nd.
          </p>
        ) : null}

        <div className="mt-4 flex gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void run("full")}
            className="flex-1 rounded-control border border-line bg-paper px-4 py-3 text-center text-sm font-bold text-ink transition-opacity disabled:opacity-60"
          >
            {preparing === "full" ? "Preparing…" : "Full image"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => void run("halves")}
            className="flex-1 rounded-control bg-accent px-4 py-3 text-center text-sm font-bold text-ink transition-opacity disabled:opacity-60"
          >
            {preparing === "halves"
              ? "Preparing…"
              : secondHalf
                ? "Download 2nd half"
                : "2 halves"}
          </button>
        </div>
      </div>
    </div>
  );
}
