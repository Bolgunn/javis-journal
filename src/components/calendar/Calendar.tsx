"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { computeCellW, type CalendarView, type FitMetrics } from "@/lib/calendar/fit";
import { pinchDecision } from "@/lib/calendar/pinch";
import {
  currentYearMonth,
  isCurrentMonth,
  todayISO,
  yearMonthKey,
  type YearMonth,
} from "@/lib/calendar/month-grid";
import { useMonthData, useProfile } from "@/lib/db/queries";
import { placeSticker, setSelectedFrame } from "@/lib/db/mutations";
import { frameBoxInsets, frameScale } from "@/lib/frames/spec";
import { seedStickers } from "@/lib/sticker/seed";
import { repairStickerThumbs } from "@/lib/image/repair-sticker-thumbs";
import { AddStampFlow } from "@/components/day/AddStampFlow";
import { DayPage } from "@/components/day/DayPage";
import { StickerLayer, visibleGridCenter } from "@/components/sticker/StickerLayer";
import { StickerTray } from "@/components/sticker/StickerTray";
import { SyncHint } from "@/components/SyncHint";
import { CalendarMenu } from "./CalendarMenu";
import { ExportSheet } from "./ExportSheet";
import { MonthCloseUp } from "./MonthCloseUp";
import { MonthFull } from "./MonthFull";
import { MonthPicker } from "./MonthPicker";
import { MonthTitle } from "./MonthTitle";
import { TopBar } from "./TopBar";
import type { MonthViewProps } from "./MonthView";

const TITLE_GRID_GAP = 12; // matches the gap-3 between title and calendar body

/** The open day page: the date, plus the cell rect the FLIP zoom grows out of (null → instant). */
export type OpenDay = { date: string; rect: DOMRect | null };

function touchDistance(touches: TouchList): number {
  const a = touches[0];
  const b = touches[1];
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
}

/** The day cell's on-screen rect, so a stamp added from an empty day still zooms out of it. */
function cellRect(date: string): DOMRect | null {
  const el = document.querySelector<HTMLElement>(`[aria-label="${date}"]`);
  return el ? el.getBoundingClientRect() : null;
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * The calendar home island. Owns `{view, year, month}` (pure client state, never the
 * URL), the shared fit measurement, the reactive month data + profile, the
 * pinch-to-switch gesture, and the ~250ms switch animation. Renders `TopBar`,
 * `MonthTitle`, and the active month view. The 3-dots menu + month picker (and the
 * handlers that change month / week-start / sign out) are wired in T6.
 */
export function Calendar() {
  const [view, setView] = useState<CalendarView>("full-month");
  const [{ year, month }, setYearMonth] = useState<YearMonth>(() =>
    currentYearMonth(),
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  // M9: the PNG export sheet, opened from the 3-dots menu.
  const [exportOpen, setExportOpen] = useState(false);
  const [openDay, setOpenDay] = useState<OpenDay | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // M7: the tray sheet, and the selected sticker (selection is what arms the sticker layer).
  const [trayOpen, setTrayOpen] = useState(false);
  const [selectedSticker, setSelectedSticker] = useState<string | null>(null);
  // Bumped once the sticker-thumb repair lands, to remount the layer onto the fixed thumbs.
  const [stickerEpoch, setStickerEpoch] = useState(0);
  const [metrics, setMetrics] = useState<FitMetrics>({
    availW: 0,
    availH: 0,
    titleH: 40,
    headerH: 24,
  });

  const mainRef = useRef<HTMLElement>(null);
  // Read by the pinch handler without re-binding it (pinch isolation, decision 10).
  const dayOpenRef = useRef(false);
  // M7: the same belt-and-braces, extended by one boolean — while a sticker is selected, a pinch
  // belongs to the sticker being scaled, never to the calendar behind it.
  const stickerSelectedRef = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const firstRender = useRef(true);

  // M8: the frame's scale is stepped off the *viewport*, not the container — the container is
  // already inside the ring, so reading it back would feed the breakpoint its own output.
  // 0 until mounted, which also keeps SSR and hydration agreeing on "no frame yet".
  const [viewportW, setViewportW] = useState(0);

  const profile = useProfile();
  const data = useMonthData(year, month);

  const todayDate = isCurrentMonth(year, month) ? todayISO() : null;

  // The frame wraps the header + grid inside each month view (FramedGrid), not this container —
  // so that the framed box is the same rectangle on screen and in the M9 export. All the island
  // owes it is the stepped scale, and the insets the fit model has to account for.
  const scale = frameScale(viewportW);
  const ring = frameBoxInsets(profile.selectedFrame, scale);
  const cellW = computeCellW(view, {
    ...metrics,
    frameW: viewportW > 0 ? ring.w : 0,
    frameH: viewportW > 0 ? ring.h : 0,
  });

  // Measure viewport + chrome heights; recompute on resize. ResizeObserver fires an
  // initial callback on observe(), so it also does the first measurement. Re-run on
  // [view] because the header element is swapped between the two views.
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() =>
      setMetrics({
        availW: el.clientWidth,
        availH: el.clientHeight,
        titleH: titleRef.current?.offsetHeight ?? 40,
        headerH: headerRef.current?.offsetHeight ?? 24,
      }),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  // Track the viewport for the frame's stepped scale (×2 / ×3 / ×4).
  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  // Animate each switch (skip the very first render / device-default correction).
  useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    if (prefersReducedMotion()) return;
    // to close-up = zoom in (grow from smaller); to full-month = zoom out.
    const fromScale = view === "close-up" ? 0.9 : 1.08;
    node.animate(
      [
        { opacity: 0, transform: `scale(${fromScale})` },
        { opacity: 1, transform: "scale(1)" },
      ],
      { duration: 250, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
    );
  }, [view]);

  // Default to close-up on coarse (touch) pointers; suppress the switch animation
  // for this one programmatic correction so first paint doesn't zoom.
  useEffect(() => {
    if (window.matchMedia("(pointer: coarse)").matches) {
      firstRender.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time device read on mount
      setView("close-up");
    }
  }, []);

  // Pinch (2-finger) gesture. We own pinch: touch-action:none on the surface +
  // preventDefault on 2-finger moves. The close-up scroller keeps touch-action:pan-x
  // so a single finger still scrolls columns.
  //
  // Pinch isolation (M6, belt and braces): while a day is open, a pinch belongs to the stamp
  // being scaled, never to the calendar behind it. The overlay stops propagation AND this
  // handler no-ops off a state check — a listener detail can be broken by a refactor; a state
  // check cannot. `dayOpenRef` keeps the check live without re-binding the listeners.
  useEffect(() => {
    const el = mainRef.current;
    if (!el) return;

    let startDist: number | null = null;
    let fired = false;

    // M7 extends the same check by one boolean: a selected sticker owns the pinch too.
    const editorOwnsGesture = () => dayOpenRef.current || stickerSelectedRef.current;

    const onTouchStart = (e: TouchEvent) => {
      if (editorOwnsGesture()) return;
      if (e.touches.length === 2) {
        startDist = touchDistance(e.touches);
        fired = false;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (editorOwnsGesture()) return;
      if (e.touches.length !== 2 || startDist == null) return;
      e.preventDefault(); // suppress native pinch-zoom while we interpret it
      if (fired) return;
      const next = pinchDecision(touchDistance(e.touches) / startDist, editorOwnsGesture());
      if (next) {
        setView(next);
        fired = true;
      }
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) startDist = null;
    };

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);
    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  useEffect(() => {
    dayOpenRef.current = openDay !== null || addingTo !== null;
  }, [openDay, addingTo]);

  useEffect(() => {
    stickerSelectedRef.current = selectedSticker !== null;
  }, [selectedSticker]);

  // Seed the 3 personal stickers into the tray (US-9) once we know who she is. Idempotent, and
  // deliberately un-awaited: it must never hold up the calendar.
  //
  // The repair first: stickers ingested before the alpha fix hold a JPEG thumb, which renders
  // their transparent pixels black. It re-encodes them to PNG in place; `stickerEpoch` then
  // remounts the layer so the corrected thumbs are re-resolved (the id set didn't change, so the
  // URL cache would otherwise happily keep serving the black ones).
  useEffect(() => {
    if (!profile.userId) return;
    void repairStickerThumbs()
      .then(() => setStickerEpoch((n) => n + 1))
      .finally(() => {
        if (profile.userId) void seedStickers(profile.userId);
      });
  }, [profile.userId]);

  // The system back gesture closes the day instead of leaving the app: opening a day pushes a
  // history entry, popstate closes it. (Closing from inside the app pops it back off.)
  useEffect(() => {
    if (!openDay) return;
    window.history.pushState({ day: openDay.date }, "");
    const onPop = () => setOpenDay(null);
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [openDay]);

  const closeDay = () => {
    setSelected(null);
    // Pop our own guard entry; the popstate listener clears the overlay state.
    if (window.history.state?.day) window.history.back();
    else setOpenDay(null);
  };

  const toggleView = () =>
    setView((v) => (v === "full-month" ? "close-up" : "full-month"));

  const onOpenDay = (date: string, rect: DOMRect) => {
    // A day opening takes the stage: a sticker left selected underneath it would keep the layer
    // armed (and its pinch guard on) behind the overlay.
    setSelectedSticker(null);
    const day = data.get(date);
    if (!day || day.stamps.length === 0) {
      // US-7, literally: an empty day never shows an empty page — it opens the picker.
      setAddingTo(date);
      return;
    }
    setOpenDay({ date, rect });
  };

  /** Stamp a tray sticker onto the month she is looking at, at the center of what she can see. */
  const onPickSticker = async (asset: { id: string; image_id: string }) => {
    const grid = gridRef.current;
    setTrayOpen(false);
    if (!grid) return;
    const placed = await placeSticker(
      yearMonthKey(year, month),
      asset.image_id,
      asset.id,
      visibleGridCenter(grid),
    );
    // It arrives SELECTED — the same beat as a freshly cut stamp: she just placed it, it is the
    // thing she is most likely to nudge, and it teaches the selection model with no tutorial.
    if (placed) setSelectedSticker(placed.id);
  };

  const viewProps: MonthViewProps = {
    year,
    month,
    startOfWeek: profile.startOfWeek,
    todayDate,
    data,
    cellW,
    frame: profile.selectedFrame,
    frameScale: scale,
    headerRef,
    onOpenDay,
    gridRef,
    stickerLayer: (
      <StickerLayer
        key={stickerEpoch}
        year={year}
        month={month}
        startOfWeek={profile.startOfWeek}
        gridW={cellW * 7}
        selected={selectedSticker}
        onSelect={setSelectedSticker}
        onOpenDay={(date) => onOpenDay(date, cellRect(date) ?? new DOMRect())}
      />
    ),
  };

  return (
    <main
      ref={mainRef}
      className="relative h-svh w-screen overflow-hidden bg-page [touch-action:none]"
    >
      <TopBar onMenu={() => setMenuOpen(true)} onStickers={() => setTrayOpen(true)} />

      <SyncHint />

      <div
        ref={containerRef}
        className="flex h-full w-full flex-col items-center justify-center"
        style={{ gap: TITLE_GRID_GAP }}
      >
        <div ref={titleRef}>
          <MonthTitle
            year={year}
            month={month}
            onLongPress={() => setPickerOpen(true)}
          />
        </div>

        {/* Keyed so a view switch replays the scale+fade on a fresh node. */}
        <div key={view} ref={bodyRef}>
          {view === "full-month" ? (
            <MonthFull {...viewProps} />
          ) : (
            <MonthCloseUp {...viewProps} />
          )}
        </div>
      </div>

      <CalendarMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onToggleView={toggleView}
        onChangeMonth={() => setPickerOpen(true)}
        onDownload={() => setExportOpen(true)}
        selectedFrame={profile.selectedFrame}
        onSetFrame={(frame) => void setSelectedFrame(frame)}
      />

      {pickerOpen ? (
        <MonthPicker
          onClose={() => setPickerOpen(false)}
          viewed={{ year, month }}
          onPick={(ym) => setYearMonth(ym)}
        />
      ) : null}

      {exportOpen ? (
        <ExportSheet
          year={year}
          month={month}
          weekStart={profile.startOfWeek}
          frame={profile.selectedFrame}
          onClose={() => setExportOpen(false)}
        />
      ) : null}

      {trayOpen ? (
        <StickerTray
          onPick={(asset) => void onPickSticker(asset)}
          onClose={() => setTrayOpen(false)}
        />
      ) : null}

      {addingTo ? (
        <AddStampFlow
          key={addingTo}
          date={addingTo}
          onPlaced={(stamp) => {
            const date = addingTo;
            setAddingTo(null);
            // Back to the day with the new stamp placed, on top, and SELECTED — she just made
            // it, it is the thing she is most likely to nudge, and it teaches the selection
            // affordance with no tutorial (decision 12).
            setOpenDay((prev) => prev ?? { date, rect: cellRect(date) });
            setSelected(stamp.id);
          }}
          onCancel={() => setAddingTo(null)}
        />
      ) : null}

      {openDay ? (
        <DayPage
          date={openDay.date}
          fromRect={openDay.rect}
          dayNumber={Number(openDay.date.slice(8))}
          selected={selected}
          onSelect={setSelected}
          onAddStamp={() => setAddingTo(openDay.date)}
          onClose={closeDay}
        />
      ) : null}
    </main>
  );
}
