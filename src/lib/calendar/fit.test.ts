import { describe, expect, test } from "vitest";

import {
  CELL_ASPECT_RATIO,
  CLOSEUP_DIVISOR,
  computeCellW,
  GUTTER,
  TITLE_GRID_GAP,
  type CalendarView,
} from "./fit";
import { FRAME_IDS, frameBoxInsets, frameScale } from "@/lib/frames/spec";

describe("computeCellW (fit model)", () => {
  test("phone-portrait full-month: width is the binding dimension", () => {
    // Tall narrow viewport → height is plentiful, width divided by 7 wins.
    const cellW = computeCellW("full-month", {
      availW: 400,
      availH: 900,
      titleH: 40,
      headerH: 24,
    });
    const usableW = 400 - GUTTER * 2; // 352
    expect(cellW).toBe(Math.floor(usableW / 7)); // 50
  });

  test("close-up at 8:5 fills a phone's height — no dead space below the grid", () => {
    // M9-INSTAGRAM-PLAN decision 2: at 2.5 columns an 8:5 close-up stopped two-thirds down the
    // screen. At 1.8 the two bounds meet on a 393×852 iPhone, so the 6 rows reach the bottom
    // gutter (within a few px of rounding) for every frame, bare included.
    expect(CLOSEUP_DIVISOR).toBe(1.8);
    const vw = 393;
    const vh = 852;
    const scale = frameScale(vw);
    for (const id of [...FRAME_IDS, "none" as const]) {
      const { w: fw, h: fh } = frameBoxInsets(id, scale);
      const m = { availW: vw, availH: vh, frameW: fw, frameH: fh, ...CHROME };
      const cellW = computeCellW("close-up", m);
      const block =
        GUTTER + m.titleH + TITLE_GRID_GAP + fh + m.headerH + (6 * cellW) / CELL_ASPECT_RATIO +
        Math.max(GUTTER, fh);
      expect(block).toBeLessThanOrEqual(vh);
      expect(vh - block).toBeLessThan(12);
    }
  });

  test("desktop-landscape: height is the binding dimension", () => {
    // Wide short viewport → the 6-row height bound wins over width/7.
    const m = { availW: 1600, availH: 700, titleH: 48, headerH: 28 };
    const usableH = m.availH - GUTTER * 2;
    const overhead = m.titleH + TITLE_GRID_GAP + m.headerH;
    const heightBoundW = Math.floor(((usableH - overhead) / 6) * CELL_ASPECT_RATIO);
    expect(computeCellW("full-month", m)).toBe(heightBoundW);
    // And it's smaller than the width-bound candidate (1600-48)/7.
    expect(heightBoundW).toBeLessThan(Math.floor((1600 - GUTTER * 2) / 7));
  });

  test("full-month divides width by 7, close-up by CLOSEUP_DIVISOR", () => {
    // Force width to bind in both by making height huge.
    const base = { availW: 700, availH: 5000, titleH: 40, headerH: 24 };
    expect(computeCellW("full-month", base)).toBe(Math.floor((700 - GUTTER * 2) / 7));
    expect(computeCellW("close-up", base)).toBe(
      Math.floor((700 - GUTTER * 2) / CLOSEUP_DIVISOR),
    );
  });

  test("never negative on a tiny/degenerate viewport", () => {
    expect(computeCellW("full-month", { availW: 0, availH: 0, titleH: 40, headerH: 24 })).toBe(0);
    expect(computeCellW("close-up", { availW: 10, availH: 10, titleH: 40, headerH: 24 })).toBe(0);
  });
});

// ---------------------------------------------------------------------------- M8: with a frame

const VIEWPORTS = [
  { name: "phone", w: 390, h: 844 },
  { name: "tablet", w: 768, h: 1024 },
  { name: "desktop", w: 1440, h: 900 },
];
const VIEWS: CalendarView[] = ["full-month", "close-up"];
const CHROME = { titleH: 40, headerH: 24 };

/** What the Calendar island hands `computeCellW`: the viewport, plus the framed box's insets. */
function framed(vw: number, vh: number, frameW: number, frameH: number) {
  return { availW: vw, availH: vh, frameW, frameH, ...CHROME };
}

describe("computeCellW with an M8 frame", () => {
  test("no frame supplied → identical to the pre-M8 model (no regression)", () => {
    for (const view of VIEWS) {
      for (const { w, h } of VIEWPORTS) {
        const bare = { availW: w, availH: h, ...CHROME };
        expect(computeCellW(view, { ...bare, frameW: 0, frameH: 0 })).toBe(
          computeCellW(view, bare),
        );
      }
    }
  });

  test("the frame is FREE on a phone in full-month: same cellW as no frame, for all 3 frames", () => {
    // The "never fights her" assertion, and the one that would regress silently. On a phone the
    // WIDTH binds in full-month, and horizontally the ring lives in the 24px gutter that fit.ts
    // already reserves as empty space — so the grid does not shrink by a single pixel.
    const { w, h } = VIEWPORTS[0];
    const scale = frameScale(w);
    expect(scale).toBe(2);

    const unframed = computeCellW("full-month", { availW: w, availH: h, ...CHROME });
    for (const id of FRAME_IDS) {
      const { w: fw, h: fh } = frameBoxInsets(id, scale);
      expect(fw).toBeLessThanOrEqual(GUTTER); // the precondition for the freebie
      expect(computeCellW("full-month", framed(w, h, fw, fh))).toBe(unframed);
    }
  });

  test("close-up on a phone is height-bound at 8:5, so only the top ring's height is paid", () => {
    // M9-INSTAGRAM-PLAN decision 2 makes the phone close-up height-bound, so the free-sides rule
    // no longer covers it: the top ring edge (the one edge that is always charged) now costs
    // `fh / 6 · 8/5` px of cell width — a couple of px, never more.
    const { w, h } = VIEWPORTS[0];
    const scale = frameScale(w);
    const unframed = computeCellW("close-up", { availW: w, availH: h, ...CHROME });
    for (const id of FRAME_IDS) {
      const { w: fw, h: fh } = frameBoxInsets(id, scale);
      const framedW = computeCellW("close-up", framed(w, h, fw, fh));
      expect(framedW).toBeLessThanOrEqual(unframed);
      expect(unframed - framedW).toBeLessThanOrEqual(Math.ceil((fh / 6) * CELL_ASPECT_RATIO) + 1);
    }
  });

  test("the framed 7×6 grid still fits, unscrolled, at every viewport × frame × view", () => {
    for (const { w, h } of VIEWPORTS) {
      const scale = frameScale(w);
      for (const id of FRAME_IDS) {
        const { w: fw, h: fh } = frameBoxInsets(id, scale);
        const m = framed(w, h, fw, fh);

        for (const view of VIEWS) {
          const cellW = computeCellW(view, m);
          expect(cellW).toBeGreaterThan(0);

          // No vertical scroll: the whole physical block — gutter, title, gap, top ring, header,
          // 6 rows, bottom ring — fits the viewport.
          const cellH = cellW / CELL_ASPECT_RATIO;
          const block =
            GUTTER + m.titleH + TITLE_GRID_GAP + fh + m.headerH + 6 * cellH + fh;
          expect(block).toBeLessThanOrEqual(m.availH);

          // No horizontal scroll in full-month: the framed box (7 columns + both rings) fits.
          if (view === "full-month") {
            expect(7 * cellW + fw * 2).toBeLessThanOrEqual(m.availW);
          }
        }
      }
    }
  });

  test("the TOP ring edge is charged — there is no gutter above it, the title is", () => {
    // Height-bound (desktop full-month). The bottom edge overhangs into the gutter like the
    // sides do; the top edge cannot, so it costs real height.
    const bare = { availW: 1920, availH: 900, ...CHROME };
    expect(computeCellW("full-month", { ...bare, frameH: 20 })).toBeLessThan(
      computeCellW("full-month", bare),
    );
  });

  test("a ring fatter than the gutter starts costing cells (and only then)", () => {
    const bare = { availW: 390, availH: 844, ...CHROME };
    // Inside the gutter: free. Past it: the grid pays the difference.
    expect(computeCellW("close-up", { ...bare, frameW: GUTTER })).toBe(
      computeCellW("close-up", bare),
    );
    expect(computeCellW("close-up", { ...bare, frameW: GUTTER + 10 })).toBeLessThan(
      computeCellW("close-up", bare),
    );
  });
});
