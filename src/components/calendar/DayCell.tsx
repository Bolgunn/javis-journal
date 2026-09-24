"use client";

import { CELL_ASPECT } from "@/lib/calendar/fit";
import type { GridCell } from "@/lib/calendar/month-grid";
import type { DayData } from "@/lib/db/queries";
import { stampBoxes } from "@/lib/day/layout";

/** The day number's size, as a fraction of the cell width — the same weight in both views.
 *  (0.1 at the old 7:6 cell; × 35/48 keeps its size relative to the cell's height.) Export's
 *  `EXPORT.DAY_FONT_RATIO` must match. */
const CHIP_FONT_RATIO = 0.073;
/** …but never so small it stops being legible on a cramped landscape phone. */
const CHIP_MIN_FONT_PX = 7;

/**
 * One day cell: a blank (leading/trailing pad) or a numbered day. When the day has stamps it
 * renders the day's **faithful mini-composition** — every live stamp at its real position,
 * scale and rotation, through the same `stampBoxes()` the day page uses, at 256px-thumb size.
 * The cell and the page are both 8:5 boxes in the same normalized coordinates, so this is one
 * layout function at two pixel sizes (and the FLIP zoom has nothing to cross-fade).
 *
 * Today is marked via the `today-bg`/`today-ink` tokens. Javi's birthday (July 18, any year) is
 * marked instead by a permanent pink heart (`birthday`/`birthday-ink` tokens) that supersedes the
 * today disc whenever the two land on the same cell.
 */
export function DayCell({
  cell,
  isToday,
  isBirthday = false,
  day,
  width,
  onOpen,
}: {
  cell: GridCell;
  isToday: boolean;
  /** True on July 18 (any year) — a permanent pink heart that wins over `isToday`. */
  isBirthday?: boolean;
  day: DayData | null;
  /** The fitted cell width in px — the page width this composition is laid out against. */
  width: number;
  onOpen?: (date: string, rect: DOMRect) => void;
}) {
  if (cell === null) {
    return (
      <div
        className="border-b border-r border-line bg-line-soft"
        style={{ aspectRatio: CELL_ASPECT }}
        aria-hidden
      />
    );
  }

  const boxes = day && width > 0 ? stampBoxes(day.stamps, day.aspects, width) : [];

  // The number is sized RELATIVE to the cell, so it carries the same visual weight in the
  // close-up as in the full month (where a fixed 24px chip swallowed the composition). Today
  // still gets its filled disc — that marker is the point; every other day is a shadowed
  // number with no disc, so it obstructs almost nothing.
  const fontPx = Math.max(CHIP_MIN_FONT_PX, Math.round(width * CHIP_FONT_RATIO));
  const padPx = Math.round(fontPx * 0.28);

  return (
    <button
      type="button"
      onClick={(e) => onOpen?.(cell.date, e.currentTarget.getBoundingClientRect())}
      aria-label={cell.date}
      className="relative block w-full overflow-hidden border-b border-r border-line bg-paper p-0 text-left"
      style={{ aspectRatio: CELL_ASPECT }}
    >
      {/* `isolate` keeps the stamps' z-indexes (layer_order, which drifts as she taps
          front/back) in their own stacking context, under the day-number chip. */}
      <div className="absolute inset-0 isolate">
        {boxes.map((box) => {
          const url = day?.urls.get(box.image_id);
          if (!url) return null;
          return (
            // Local object-URL / signed thumb from getThumbUrls (ALG-6); next/image can't
            // optimize blob:/signed URLs and would fight the local-first model.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={box.id}
              src={url}
              alt=""
              loading="lazy"
              draggable={false}
              className="absolute origin-center"
              style={{
                left: box.x,
                top: box.y,
                width: box.w,
                height: box.h,
                zIndex: box.z,
                transform: `rotate(${box.rot}deg)`,
              }}
            />
          );
        })}
      </div>

      {isBirthday ? (
        // Javi's birthday: a permanent pink heart holding the day number, at the same corner as
        // every other marker. It wins over the today disc. The heart is an inline SVG (fills the
        // box, so it's crisp at every fitted size across both views); the number rides slightly
        // high so it sits on the lobes, not over the point.
        <span
          className="absolute z-10 grid place-items-center"
          style={{ left: padPx, top: padPx, width: fontPx * 2.15, height: fontPx * 2 }}
        >
          <svg
            viewBox="0 0 32 29.6"
            className="absolute inset-0 size-full"
            fill="var(--color-birthday)"
            aria-hidden
          >
            <path d="M23.6 0c-3.4 0-6.3 2.4-7.6 5.1C14.7 2.4 11.8 0 8.4 0 3.8 0 0 3.8 0 8.4c0 9.3 9.5 11.8 16 21.2 6.5-9.4 16-11.9 16-21.2C32 3.8 28.2 0 23.6 0z" />
          </svg>
          <span
            className="relative font-bold leading-none text-birthday-ink"
            style={{ fontSize: fontPx, transform: `translateY(${-fontPx * 0.12}px)` }}
          >
            {cell.day}
          </span>
        </span>
      ) : (
        <span
          className={`absolute z-10 grid place-items-center rounded-full font-bold leading-none ${
            isToday ? "bg-today-bg text-today-ink" : "text-ink"
          }`}
          style={{
            left: padPx,
            top: padPx,
            fontSize: fontPx,
            minWidth: fontPx * 1.9,
            height: fontPx * 1.9,
            // No disc on an ordinary day — the number rides on the photo with a soft halo, so it
            // stays legible over any stamp while obstructing almost none of it.
            textShadow: isToday
              ? undefined
              : "0 0 2px var(--color-paper), 0 0 4px var(--color-paper)",
          }}
        >
          {cell.day}
        </span>
      )}
    </button>
  );
}
