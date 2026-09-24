"use client";

// The day page (US-7, US-8): a client overlay INSIDE the Calendar island — not a route. The
// calendar (and its warm thumb handles) stays mounted underneath, view state never enters the
// URL, and the back gesture is guarded by Calendar's history entry. The calendar showing through
// the scrim around the page *is* the peeking-neighbours decoration (decision 20): it is not
// navigable and it loads no new images.
//
// The page IS the 8:5 calendar cell zoomed (CELL_ASPECT — reused, never re-invented), so the
// cell's mini-composition and this page are the same `stampBoxes()` at two pixel sizes. It
// FLIP-animates out of the tapped cell and NEVER waits on that animation.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { deleteStamp, restoreStamp, updateStamp } from "@/lib/db/mutations";
import { useDayView } from "@/lib/db/queries";
import type { RotationDeg } from "@/lib/db/types";
import { DayGestures, type LiveTransform } from "@/lib/day/gestures";
import { applyLive, stampBoxes } from "@/lib/day/layout";
import { PAGE_ASPECT, canPlace, toggleFrontBack } from "@/lib/day/place";
import { useFinePointer } from "@/lib/ui/pointer";
import { TransformBar } from "@/components/ui/TransformBar";
import { DayStamp } from "./DayStamp";
import { UndoToast } from "./UndoToast";

const FLIP_MS = 250; // matches Calendar's view-switch animation
const PAGE_INSET = 0.86; // the page fills this much of the viewport; the rest is the peeks
const DELETE_SIZE = 44; // a full touch target
const DELETE_OFFSET = 8; // px the ✕ floats OUTSIDE the stamp's corner (never blocks a pinch)

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/** The largest 8:5 page that fits the given box. */
function fitPage(w: number, h: number): { w: number; h: number } {
  const byWidth = { w, h: w / PAGE_ASPECT };
  return byWidth.h <= h ? byWidth : { w: h * PAGE_ASPECT, h };
}

export type DayPageProps = {
  date: string;
  /** The tapped cell's rect — the FLIP zoom grows out of it. Null → an instant open. */
  fromRect: DOMRect | null;
  /** The day number, shown in the same chip `DayCell` renders (decision 19: no title). */
  dayNumber: number;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onAddStamp: () => void;
  onClose: () => void;
};

export function DayPage({
  date,
  fromRect,
  dayNumber,
  selected,
  onSelect,
  onAddStamp,
  onClose,
}: DayPageProps) {
  const { stamps, urls, aspects } = useDayView(date);
  const fine = useFinePointer();
  const [pageBox, setPageBox] = useState({ w: 0, h: 0 });
  const [live, setLive] = useState<LiveTransform | null>(null);
  const [undo, setUndo] = useState<{ id: string; layer_order: number } | null>(null);

  const pageRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const gesturesRef = useRef<DayGestures | null>(null);
  // The gesture machine outlives every render; this is how it reads the *current* stamps and
  // callbacks without being rebuilt (and without touching a ref during render).
  const ctxRef = useRef({ stamps, onSelect });

  const boxes = useMemo(
    () => (pageBox.w > 0 ? stampBoxes(stamps, aspects, pageBox.w) : []),
    [stamps, aspects, pageBox.w],
  );

  // Measure the page: the largest 8:5 box inside the viewport inset (the inset is what leaves
  // the calendar peeking around it).
  useLayoutEffect(() => {
    const measure = () =>
      setPageBox(fitPage(window.innerWidth * PAGE_INSET, window.innerHeight * PAGE_INSET));
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // FLIP: grow from the tapped cell's rect to the page rect. The page is already rendered and
  // interactive — this only decorates it, and any failure just means an instant open.
  useEffect(() => {
    const node = pageRef.current;
    if (!node || !fromRect || pageBox.w === 0 || prefersReducedMotion()) return;
    const to = node.getBoundingClientRect();
    if (to.width === 0 || to.height === 0) return;

    const sx = fromRect.width / to.width;
    const sy = fromRect.height / to.height;
    const dx = fromRect.left + fromRect.width / 2 - (to.left + to.width / 2);
    const dy = fromRect.top + fromRect.height / 2 - (to.top + to.height / 2);
    node.animate(
      [
        { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})`, opacity: 0.7 },
        { transform: "none", opacity: 1 },
      ],
      { duration: FLIP_MS, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
    );
    // Open-time only; `fromRect` is stable for the life of the overlay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageBox.w]);

  // ---- gestures (ALG-9): select → drag / pinch / twist; tap → front/back ----
  useEffect(() => {
    const g = new DayGestures({
      onChange: setLive,
      // Exactly ONE write per gesture, on gesture-end — never per animation frame.
      onCommit: (t) =>
        void updateStamp(t.id, {
          pos_x: t.pos_x,
          pos_y: t.pos_y,
          scale: t.scale,
          rotation_deg: t.rotation_deg as RotationDeg,
        }),
      onTap: (id) =>
        void updateStamp(id, {
          layer_order: toggleFrontBack(ctxRef.current.stamps, id),
        }),
      onSelect: (id) => ctxRef.current.onSelect(id),
      onDeselect: () => ctxRef.current.onSelect(null),
    });
    gesturesRef.current = g;
    return () => {
      g.cancel();
      gesturesRef.current = null;
    };
  }, []);

  // Feed the machine the current composition + selection (they change as she edits).
  useEffect(() => {
    ctxRef.current = { stamps, onSelect };
    gesturesRef.current?.setContext(boxes, pageBox.w, selected);
  }, [stamps, onSelect, boxes, pageBox.w, selected]);

  const localPoint = useCallback((e: React.PointerEvent) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }, []);

  const onDelete = useCallback(async () => {
    if (!selected) return;
    const layerOrder = await deleteStamp(selected);
    onSelect(null);
    if (layerOrder !== null) setUndo({ id: selected, layer_order: layerOrder });
  }, [selected, onSelect]);

  // Wheel = scale the selected stamp (desktop's pinch). Non-passive so the page can't scroll
  // under it. It scales live per notch and writes once the wheel goes quiet (WHEEL_COMMIT_MS).
  useEffect(() => {
    const el = surfaceRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!selected) return; // selection is the gate for the mouse too
      e.preventDefault();
      gesturesRef.current?.wheel(e.deltaY);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [selected]);

  // The keyboard extras. Bound regardless of pointer type — a keyboard on a tablet is still a
  // keyboard — but the desktop bar is the discoverable path; these are the accelerator.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const g = gesturesRef.current;
      if (e.key === "Escape") {
        // Deselect first, then close — what every editor does, so a stray Escape never throws
        // her out of a day she is mid-arrangement in.
        if (selected) onSelect(null);
        else onClose();
        return;
      }
      if (!selected || !g) return;
      switch (e.key) {
        case "ArrowLeft":
          g.rotateStep(-1);
          break;
        case "ArrowRight":
          g.rotateStep(1);
          break;
        case "+":
        case "=":
          g.scaleStep(1);
          break;
        case "-":
        case "_":
          g.scaleStep(-1);
          break;
        case "Delete":
        case "Backspace":
          void onDelete();
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, onSelect, onClose, onDelete]);

  const liveFor = (id: string) => (live && live.id === id ? live : null);
  const selectedBox = boxes.find((b) => b.id === selected) ?? null;
  const selectedLive = selectedBox
    ? applyLive(selectedBox, liveFor(selectedBox.id), pageBox.w)
    : null;

  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-ink/45 [touch-action:none]"
      // Pinch isolation (belt): a two-finger gesture in here must never reach the calendar's
      // pinch-to-switch. (Braces: Calendar's own handler also no-ops while a day is open.)
      onTouchStart={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onTouchEnd={(e) => e.stopPropagation()}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose(); // backdrop tap → back to the calendar
      }}
    >
      <div
        ref={pageRef}
        className="relative overflow-hidden rounded-cell bg-paper shadow-sm"
        style={{ width: pageBox.w, height: pageBox.h }}
      >
        {/* The gesture surface. `isolate` keeps the stamps' z-indexes (layer_order, which
            drifts as she taps front/back) in their own stacking context, under the chrome. */}
        <div
          ref={surfaceRef}
          className="absolute inset-0 isolate [touch-action:none]"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            gesturesRef.current?.pointerDown(e.pointerId, localPoint(e));
          }}
          onPointerMove={(e) => gesturesRef.current?.pointerMove(e.pointerId, localPoint(e))}
          onPointerUp={(e) => gesturesRef.current?.pointerUp(e.pointerId)}
          onPointerCancel={(e) => gesturesRef.current?.pointerUp(e.pointerId)}
        >
          {boxes.map((box) => (
            <DayStamp
              key={box.id}
              box={applyLive(box, liveFor(box.id), pageBox.w)}
              url={urls.get(box.image_id)}
              selected={box.id === selected}
            />
          ))}
        </div>

        {/* The day-number chip — the same chip DayCell renders, scaled up, so the FLIP zoom
            has nothing popping in or out. No title (decision 19). */}
        <span className="pointer-events-none absolute left-3 top-3 z-20 grid h-10 min-w-10 place-items-center rounded-full bg-paper/85 px-2 text-xl font-bold text-ink">
          {dayNumber}
        </span>

        {/* Delete: a 44px ✕ floating just OFF the selection's top-right corner, outside the
            stamp's bounds so it never blocks a pinch. At most one on screen. */}
        {selectedLive ? (
          <button
            type="button"
            aria-label="Delete stamp"
            onClick={() => void onDelete()}
            className="absolute z-30 grid place-items-center rounded-full bg-paper text-lg font-bold text-ink shadow-sm"
            style={{
              width: DELETE_SIZE,
              height: DELETE_SIZE,
              left: Math.max(
                0,
                Math.min(
                  pageBox.w - DELETE_SIZE,
                  selectedLive.x + selectedLive.w + DELETE_OFFSET,
                ),
              ),
              top: Math.max(
                0,
                Math.min(
                  pageBox.h - DELETE_SIZE,
                  selectedLive.y - DELETE_OFFSET - DELETE_SIZE,
                ),
              ),
            }}
          >
            ✕
          </button>
        ) : null}

        {undo ? (
          <UndoToast
            onUndo={() => {
              void restoreStamp(undo.id, undo.layer_order);
              onSelect(undo.id);
              setUndo(null);
            }}
            onDismiss={() => setUndo(null)}
          />
        ) : null}
      </div>

      {/* Desktop only: a mouse cannot pinch or twist, so scale and rotate become buttons (the
          shared bar — the sticker layer renders the same one). */}
      {fine && selected ? (
        <TransformBar
          onScale={(d) => gesturesRef.current?.scaleStep(d)}
          onRotate={(d) => gesturesRef.current?.rotateStep(d)}
        />
      ) : null}

      {/* The + FAB: bottom-right, and HIDDEN (not disabled) at 3 stamps — a greyed-out button
          invites a tap that does nothing, which is the app fighting her (decision 11). */}
      {canPlace(stamps) ? (
        <button
          type="button"
          aria-label="Add a stamp"
          onClick={onAddStamp}
          className="absolute bottom-6 right-6 z-50 grid h-14 w-14 place-items-center rounded-full bg-accent text-3xl leading-none text-paper shadow-sm"
        >
          +
        </button>
      ) : null}
    </div>
  );
}
