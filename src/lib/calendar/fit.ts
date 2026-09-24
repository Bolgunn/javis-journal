// Shared cell-fit model, ported from /preview/interactive. Pure math: given
// the available box + measured chrome heights, decide the day-cell width so the 8:5
// cells fill the binding dimension (width on phone-portrait, height on desktop-
// landscape), the 6 rows never scroll vertically, and leftover space becomes
// symmetric margins. Tiny cells on short/landscape viewports are acceptable — the
// grid shrinks, it never scrolls.

export type CalendarView = "close-up" | "full-month";

export const GUTTER = 24; // minimum breathing room around the calendar
export const TITLE_GRID_GAP = 12; // matches the gap-3 between title and calendar body
export const CLOSEUP_DIVISOR = 2.5; // columns visible at rest in close-up
export const FULL_DIVISOR = 7; // full-month shows all 7 columns

/**
 * Cells keep a fixed 8:5 (width:height) ratio — and the M6 day page is that same cell
 * zoomed, so this one ratio is the coordinate box every stamp is normalized to.
 *
 * 8:5 (was 7:6 until the Instagram addendum, M9-INSTAGRAM-PLAN decision 1) so a month lays out
 * on a 2160×1350 two-photo Instagram carousel with the PNG still matching the screen.
 */
export const CELL_ASPECT_RATIO = 8 / 5;

/** The CSS `aspect-ratio` form of {@link CELL_ASPECT_RATIO}. */
export const CELL_ASPECT = "8 / 5";

export type FitMetrics = {
  /** Available box width (px). */
  availW: number;
  /** Available box height (px). */
  availH: number;
  /** Measured month-title height (px). */
  titleH: number;
  /** Measured weekday-header height (px). */
  headerH: number;
  /** M8: the framed box's per-side horizontal inset (ring + mat), px. 0 = no frame. */
  frameW?: number;
  /** M8: the framed box's per-side vertical inset (ring + mat), px. 0 = no frame. */
  frameH?: number;
};

/**
 * Cell width for the given view + metrics. Picks the smaller of the width-bound and
 * height-bound candidates so the grid always fits without vertical scroll and the
 * binding dimension wins. Floored, never negative.
 *
 * The M8 frame wraps the weekday header + grid, and is charged **per edge**, by one rule: a ring
 * edge that sits at the block's outer boundary may overhang into the GUTTER — which is currently
 * just empty breathing room — while an edge facing interior chrome must be paid for.
 *
 *  • **Left, right and bottom are free.** Those ring edges ARE the block's outer edge, so the
 *    inset from the viewport becomes `max(GUTTER, frame)`, never `GUTTER + frame`. Every ring is
 *    ≤ 24px at phone scale, so `cellW` on a phone is bit-identical with and without a frame.
 *    This is "never fights her", and it is the assertion that would regress silently.
 *
 *  • **The top edge is charged.** It is the one ring edge NOT at the boundary — the month title
 *    sits above it — so there is no gutter there to overhang into, and `frameH` joins the height
 *    overhead alongside the title and header.
 */
export function computeCellW(view: CalendarView, m: FitMetrics): number {
  const frameW = m.frameW ?? 0;
  const frameH = m.frameH ?? 0;

  const usableW = m.availW - Math.max(GUTTER, frameW) * 2;
  // Top gutter is untouched (it sits above the title); the bottom one absorbs the bottom ring.
  const usableH = m.availH - GUTTER - Math.max(GUTTER, frameH);
  const overhead = m.titleH + TITLE_GRID_GAP + m.headerH + frameH;
  const heightBoundW = ((usableH - overhead) / 6) * CELL_ASPECT_RATIO;
  const divisor = view === "full-month" ? FULL_DIVISOR : CLOSEUP_DIVISOR;
  const widthBoundW = usableW / divisor;
  return Math.max(0, Math.floor(Math.min(widthBoundW, heightBoundW)));
}
