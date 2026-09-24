"use client";

// The punch machine (US-6, M6 — this replaces M5's placeholder pastel card).
//
// Three layers, and the order is the whole trick: the machine art has a GENUINE TRANSPARENT
// HOLE where its window is, so the live preview canvas sits BEHIND the art and shows through it.
//
//     canvas (the photo, framed behind the mask)   z-0
//     the machine art (punch.webp, with its hole)  z-10, pointer-events: none
//     the controls (chevrons · drawer · ✕)         z-20, only the controls take pointers
//
// Framing is direct manipulation: drag to pan, two fingers to pinch-zoom and twist-rotate
// (continuous — any angle is legal, the bake absorbs it). The cut is a PRESS ON THE DRAWER
// PLATE, which depresses and darkens; the stamp then emerges from the slot into the drawer —
// that beat is the seam M10's flourish (US-14) hangs off, and it must never block the cut.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { playCut, unlockAudio } from "@/lib/audio/cut-sound";
import { ImagePipelineError } from "@/lib/image/process";
import { bakeStamp } from "@/lib/stamp/bake";
import { decodeForCutter } from "@/lib/stamp/decode";
import {
  CUTTER_ROTATE_STEP_DEG,
  CutterController,
  type CutterState,
} from "@/lib/stamp/gestures";
import { ingestStamp } from "@/lib/stamp/ingest-stamp";
import { MASKS, type MaskId } from "@/lib/stamp/masks";
import { PUNCH_ASPECT, punchWindow } from "@/lib/stamp/punch";
import { renderFrame } from "@/lib/stamp/render";
import { useFinePointer } from "@/lib/ui/pointer";

export type StamperProps = {
  /** The picked photo (transient — decoded to frame, discarded on confirm). */
  file: File;
  /** Called with the baked stamp's image id + the shape she cut, after a successful Cut. */
  onConfirm: (imageId: string, maskType: MaskId) => void;
  /** Called when the user backs out without cutting. Nothing has been written. */
  onCancel: () => void;
};

type Phase = "decoding" | "ready" | "error";

const MAX_DPR = 2; // cap the preview backing store for perf on high-DPR phones
const EJECT_MS = 260; // the stamp's beat in the drawer before it lands on the day page

/** The drawer plate (the press-to-cut surface), the slot, and the empty top bezel the shape
 *  cycle sits on — all fractions of the art, measured off `punch.webp`. Re-exporting the art
 *  means re-measuring these three objects. */
const DRAWER = { left: 0.11, top: 0.65, w: 0.78, h: 0.21 };
const SLOT = { cx: 0.49, y: 0.47 };
const BEZEL_TOP = 0.055; // the plastic band above the window
const STAMP_PX = 46; // the emerging stamp's size in the drawer beat

function GutterButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className="grid h-12 w-12 place-items-center rounded-full bg-paper text-xl text-ink shadow-sm"
    >
      {children}
    </button>
  );
}

export function Stamper({ file, onConfirm, onCancel }: StamperProps) {
  const [maskIndex, setMaskIndex] = useState(0);
  const [transform, setTransform] = useState<CutterState>({
    offX: 0,
    offY: 0,
    scale: 1,
    rotation: 0,
  });
  const [art, setArt] = useState({ w: 0, h: 0 });
  const [phase, setPhase] = useState<Phase>("decoding");
  const [busy, setBusy] = useState(false);
  const [ejecting, setEjecting] = useState(false);
  const [ejectUrl, setEjectUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ejectUrlRef = useRef<string | null>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const machineRef = useRef<HTMLDivElement | null>(null);

  // Controller (created once, stable). onChange mirrors the live transform into React state.
  const [controller] = useState(() => new CutterController(setTransform));
  const fine = useFinePointer();

  const mask = MASKS[maskIndex];
  const win = useMemo(
    () => punchWindow(art.w, art.h, mask.aspect),
    [art.w, art.h, mask.aspect],
  );

  // Decode the picked file → EXIF-baked bitmap, then seed the controller. The component is
  // mounted fresh per pick (keyed by file upstream), so phase "decoding" holds until this
  // resolves; the async handlers own all state transitions.
  useEffect(() => {
    let cancelled = false;
    decodeForCutter(file)
      .then((bmp) => {
        if (cancelled) {
          bmp.close();
          return;
        }
        bitmapRef.current?.close();
        bitmapRef.current = bmp;
        controller.setImage(bmp.width, bmp.height);
        controller.setMask(MASKS[maskIndex].aspect);
        setPhase("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setError(
          err instanceof ImagePipelineError
            ? err.message
            : `Could not open that photo: ${String(err)}`,
        );
        setPhase("error");
      });
    return () => {
      cancelled = true;
    };
    // maskIndex intentionally excluded: a fresh decode only depends on the file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  // Measure the machine art (fitted by height, centered — the leftover side gutters hold the
  // chevrons), so the hole's on-screen rect can be derived from PUNCH_WINDOW.
  useEffect(() => {
    const el = machineRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const box = entries[0]?.contentRect;
      if (box) setArt({ w: box.width, h: box.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Keep the controller's window size in sync (drag→source-px conversion depends on it).
  useEffect(() => {
    controller.setWindow(win.w, win.h);
  }, [win.w, win.h, controller]);

  // Re-cover when the mask (aspect) changes.
  useEffect(() => {
    if (phase === "ready") controller.setMask(mask.aspect);
  }, [mask.aspect, phase, controller]);

  // Draw the live preview via the SAME render path as the bake (preview == bake).
  useEffect(() => {
    const canvas = canvasRef.current;
    const bmp = bitmapRef.current;
    if (!canvas || !bmp || phase !== "ready" || win.w < 1) return;

    const dpr = Math.min(MAX_DPR, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    const bw = Math.max(1, Math.round(win.w * dpr));
    const bh = Math.max(1, Math.round(win.h * dpr));
    if (canvas.width !== bw) canvas.width = bw;
    if (canvas.height !== bh) canvas.height = bh;
    canvas.style.width = `${win.w}px`;
    canvas.style.height = `${win.h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    renderFrame(ctx, bmp, mask, transform, { width: bw, height: bh });
  }, [transform, win.w, win.h, mask, phase]);

  // Non-passive wheel so we can preventDefault the page scroll while zooming (desktop).
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      controller.wheel(e.deltaY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [phase, controller]);

  // The system back gesture cancels the machine (writing nothing), as the ✕ does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Release the transient bitmap AND the eject thumb's object URL on unmount (the eject <img>
  // holds a temporary URL for bake.thumbBlob; the parent swaps the Stamper away on confirm).
  useEffect(
    () => () => {
      bitmapRef.current?.close();
      bitmapRef.current = null;
      if (ejectUrlRef.current) {
        URL.revokeObjectURL(ejectUrlRef.current);
        ejectUrlRef.current = null;
      }
    },
    [],
  );

  const localPoint = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      const { x, y } = localPoint(e);
      controller.pointerDown(e.pointerId, x, y);
    },
    [controller, localPoint],
  );
  const onPointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      const { x, y } = localPoint(e);
      controller.pointerMove(e.pointerId, x, y);
    },
    [controller, localPoint],
  );
  const onPointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      controller.pointerUp(e.pointerId);
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
    [controller],
  );

  const cycleMask = useCallback((dir: 1 | -1) => {
    setMaskIndex((i) => (i + dir + MASKS.length) % MASKS.length);
  }, []);

  const onCut = useCallback(async () => {
    const bmp = bitmapRef.current;
    if (!bmp || busy || phase !== "ready") return;
    // Unlock audio while we are still inside the drawer-press gesture (this runs synchronously
    // before the first await), so the snip that fires after the async bake is not autoplay-blocked.
    unlockAudio();
    setBusy(true);
    setError(null);
    try {
      const bake = await bakeStamp(bmp, MASKS[maskIndex], controller.getState());
      const id = await ingestStamp(bake);
      // We only reach here AFTER the bake resolved, so the snip is structurally impossible to
      // hear over a failed bake (decision 4 — fail-closed). Fire-and-forget: it never delays us.
      playCut();

      // prefers-reduced-motion → skip the eject beat entirely, straight to confirm (as the FLIP
      // zoom already does). No object URL, no delay.
      const reduced =
        typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (reduced) {
        onConfirm(id, MASKS[maskIndex].id);
        return;
      }

      // Emerge the REAL baked stamp (its true WebP-alpha shape — heart/cloud corners transparent),
      // not a blank square. A temporary object URL, revoked once the beat is done.
      const url = URL.createObjectURL(bake.thumbBlob);
      ejectUrlRef.current = url;
      setEjectUrl(url);
      setEjecting(true);
      await new Promise((r) => setTimeout(r, EJECT_MS));
      if (ejectUrlRef.current) {
        URL.revokeObjectURL(ejectUrlRef.current);
        ejectUrlRef.current = null;
      }
      onConfirm(id, MASKS[maskIndex].id);
    } catch (err) {
      setEjecting(false);
      setError(
        err instanceof ImagePipelineError
          ? `Cut failed: ${err.message}`
          : `Cut failed: ${String(err)}`,
      );
    } finally {
      setBusy(false);
    }
  }, [busy, phase, maskIndex, onConfirm, controller]);

  const px = (v: number) => `${v}px`;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-hidden bg-page">
      {/* The machine: fitted by HEIGHT (100svh), centered; the leftover side gutters hold the
          chevrons, as in the mock. */}
      <div
        ref={machineRef}
        className="relative h-svh"
        style={{ aspectRatio: `${PUNCH_ASPECT}`, touchAction: "none" }}
      >
        {/* z-0 — the live preview, BEHIND the art, showing through its transparent hole. */}
        {phase === "ready" ? (
          <canvas
            ref={canvasRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            className="absolute z-0 cursor-move touch-none select-none"
            style={{ left: px(win.left), top: px(win.top) }}
          />
        ) : (
          <div
            className="absolute z-0 grid place-items-center bg-accent-soft text-center text-sm text-muted"
            style={{ left: px(win.left), top: px(win.top), width: px(win.w), height: px(win.h) }}
          >
            {phase === "error" ? (error ?? "Could not open that photo.") : "Opening photo…"}
          </div>
        )}

        {/* z-10 — the machine art. Pointer-transparent, so every gesture reaches the canvas. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/stamper/punch.webp"
          alt=""
          draggable={false}
          className="pointer-events-none absolute inset-0 z-10 h-full w-full select-none"
        />

        {/* z-20 — the controls. */}
        <button
          type="button"
          aria-label="Close"
          onClick={onCancel}
          className="absolute left-2 top-2 z-20 grid h-11 w-11 place-items-center rounded-full bg-paper/85 text-lg font-bold text-ink shadow-sm"
        >
          ✕
        </button>

        {/* The drawer plate IS the cut button: it depresses and darkens on :active, and carries
            a small legible label (a photorealistic plate with no text is a discoverability
            gamble on the one screen she uses daily — decision 18). */}
        <button
          type="button"
          onClick={() => void onCut()}
          disabled={phase !== "ready" || busy}
          aria-label="Cut the stamp"
          className="absolute z-20 grid place-items-center rounded-[14%] bg-ink/0 text-sm font-semibold uppercase tracking-[0.3em] text-ink/70 transition active:translate-y-[2px] active:bg-ink/20 disabled:opacity-40"
          style={{
            left: px(DRAWER.left * art.w),
            top: px(DRAWER.top * art.h),
            width: px(DRAWER.w * art.w),
            height: px(DRAWER.h * art.h),
          }}
        >
          {busy ? "cutting…" : "cut"}
        </button>

        {/* DESKTOP shape cycle: a chip ON the machine's top bezel, directly above the window
            whose shape it changes — because a desktop window is wide, and the phone's gutter
            chevrons would be stranded miles from the thing they control. The gutters themselves
            are spoken for on desktop (zoom/rotate, below). A phone never renders this. */}
        {fine ? (
          <div
            className="absolute z-20 flex -translate-x-1/2 items-center gap-2 rounded-full bg-paper/85 px-2 py-1 shadow-sm"
            style={{ left: "50%", top: px(BEZEL_TOP * art.h) }}
          >
            <button
              type="button"
              aria-label="Previous shape"
              onClick={() => cycleMask(-1)}
              className="grid h-9 w-9 place-items-center rounded-full text-xl text-ink"
            >
              ‹
            </button>
            <span className="min-w-16 text-center text-xs font-semibold uppercase tracking-widest text-ink">
              {mask.label}
            </span>
            <button
              type="button"
              aria-label="Next shape"
              onClick={() => cycleMask(1)}
              className="grid h-9 w-9 place-items-center rounded-full text-xl text-ink"
            >
              ›
            </button>
          </div>
        ) : null}

        {/* The cut stamp emerging from the slot into the drawer — that is what the slot and the
            drawer are FOR. A beat, never a blocker. It is now the REAL baked thumb (its own
            transparent WebP-alpha corners), so she watches HER stamp drop into the drawer.
            object-contain keeps a non-square shape (heart/cloud) inside the little emerging box. */}
        {ejecting && ejectUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={ejectUrl}
            alt=""
            aria-hidden
            draggable={false}
            className="pointer-events-none absolute z-[15] select-none object-contain drop-shadow-sm"
            style={{
              left: px(SLOT.cx * art.w - STAMP_PX / 2),
              top: px(SLOT.y * art.h),
              width: STAMP_PX,
              height: STAMP_PX,
              animation: `punch-eject ${EJECT_MS}ms cubic-bezier(0.2, 0.7, 0.2, 1) both`,
            }}
          />
        ) : null}
      </div>

      {/* PHONE shape cycle: fat chevrons in the side gutters, with the shape's name under the
          machine. On a narrow phone the gutters collapse onto the machine's own edges — which is
          exactly where the thumbs already rest — and nothing else competes for them, because the
          zoom/rotate clusters below are desktop-only. A desktop never renders these (it gets the
          bezel chip instead). */}
      {!fine ? (
        <>
          <button
            type="button"
            aria-label="Previous shape"
            onClick={() => cycleMask(-1)}
            className="absolute left-2 top-1/2 z-20 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full bg-paper/85 text-2xl text-ink shadow-sm"
          >
            ‹
          </button>
          <button
            type="button"
            aria-label="Next shape"
            onClick={() => cycleMask(1)}
            className="absolute right-2 top-1/2 z-20 grid h-14 w-14 -translate-y-1/2 place-items-center rounded-full bg-paper/85 text-2xl text-ink shadow-sm"
          >
            ›
          </button>
          <span className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 text-xs uppercase tracking-widest text-muted">
            {mask.label}
          </span>
        </>
      ) : null}

      {/* Desktop only: a mouse has no second finger, so the pinch (zoom) and the twist (rotate)
          become explicit buttons — otherwise the photo can only be panned and wheel-zoomed, and
          the rotation the cutter is built around is simply unreachable. They live in the side
          gutters, which on desktop the shape chevrons have vacated for the bezel chip. */}
      {fine && phase === "ready" ? (
        <>
          <div className="absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-2">
            <GutterButton label="Zoom in" onClick={() => controller.zoomIn()}>
              +
            </GutterButton>
            <GutterButton label="Zoom out" onClick={() => controller.zoomOut()}>
              −
            </GutterButton>
          </div>
          <div className="absolute right-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-2">
            <GutterButton
              label="Rotate left"
              onClick={() => controller.rotateByDeg(-CUTTER_ROTATE_STEP_DEG)}
            >
              ⟲
            </GutterButton>
            <GutterButton
              label="Rotate right"
              onClick={() => controller.rotateByDeg(CUTTER_ROTATE_STEP_DEG)}
            >
              ⟳
            </GutterButton>
          </div>
          <p className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 text-xs text-muted">
            drag to move · scroll to zoom
          </p>
        </>
      ) : null}

      {error && phase === "ready" ? (
        <p className="absolute inset-x-6 bottom-16 z-30 rounded-control bg-paper p-3 text-center text-sm text-accent shadow-sm">
          {error}
        </p>
      ) : null}

      <style>{`@keyframes punch-eject {
        from { transform: translateY(-10px) scale(0.65); opacity: 0; }
        60%  { opacity: 1; }
        to   { transform: translateY(60px) scale(1); opacity: 1; }
      }`}</style>
    </div>
  );
}
