"use client";

// M9 — the export bottom sheet (US-12). Same overlay posture as the M7 sticker tray / the
// calendar menu: a sheet over the calendar so she keeps seeing the month she is saving. One
// choice (include the month/year title band, default ON — a per-export taste, not worth a
// persisted profile field) and TWO explicit actions:
//   • Share (left, secondary): always the native share sheet (Messages / AirDrop / Save to Photos).
//   • Save  (right, primary):  always a direct download, never the share sheet.
// Neither ever silently becomes the other — that crossover was the confusing part of the old
// single button. Share only renders where file-sharing is actually supported (`canShareFiles`);
// where it isn't, Save spans the full width.
//
// Async states: one shared lock (`preparing`) disables both while either works; the tapped button
// shows "Preparing…". On success the sheet closes; on a share DISMISSAL it stays open (she can
// Save instead); a failure keeps the sheet open with a tailored inline message — compose failures
// and share failures read differently, and neither falls back to the other action.

import { useEffect, useState } from "react";

import type { SelectedFrame } from "@/lib/db/types";
import { composeMonthPng } from "@/lib/export/exportMonthPng";
import { canShareFiles, downloadBlob, exportFilename, shareBlob } from "@/lib/export/save";

type Preparing = "share" | "save" | null;
type ErrorKind = "compose" | "share" | null;

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
  const [error, setError] = useState<ErrorKind>(null);
  // Feature-detect after mount (navigator is client-only; default hidden avoids an SSR mismatch
  // and a flash of a dead button). On her iPhone this flips true immediately.
  const [shareable, setShareable] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time capability read on mount
    setShareable(canShareFiles());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const busy = preparing !== null;

  /** Compose once for this tap; the title toggle affects the output, so we never cache. */
  const compose = async () =>
    (await composeMonthPng(year, month, weekStart, frame, includeTitle)).full;

  const onShare = async () => {
    if (busy) return;
    setPreparing("share");
    setError(null);
    let blob: Blob;
    try {
      blob = await compose();
    } catch {
      setPreparing(null);
      setError("compose");
      return;
    }
    try {
      const result = await shareBlob(blob, exportFilename(year, month));
      if (result === "shared") onClose();
      else setPreparing(null); // dismissed — keep the sheet open so she can Save instead
    } catch {
      setPreparing(null);
      setError("share");
    }
  };

  const onSave = async () => {
    if (busy) return;
    setPreparing("save");
    setError(null);
    try {
      const blob = await compose();
      downloadBlob(blob, exportFilename(year, month));
      onClose();
    } catch {
      setPreparing(null);
      setError("compose");
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
          onClick={() => setIncludeTitle((v) => !v)}
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

        {error ? (
          <p className="mt-3 text-center text-sm text-accent">
            {error === "share"
              ? "Couldn't share — try Save instead."
              : "Couldn't create the image — try again."}
          </p>
        ) : null}

        <div className="mt-4 flex gap-3">
          {shareable ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onShare()}
              className="flex-1 rounded-control border border-line bg-paper px-4 py-3 text-center text-sm font-bold text-ink transition-opacity disabled:opacity-60"
            >
              {preparing === "share" ? "Preparing…" : "Share"}
            </button>
          ) : null}

          <button
            type="button"
            disabled={busy}
            onClick={() => void onSave()}
            className="flex-1 rounded-control bg-accent px-4 py-3 text-center text-sm font-bold text-ink transition-opacity disabled:opacity-60"
          >
            {preparing === "save" ? "Preparing…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
