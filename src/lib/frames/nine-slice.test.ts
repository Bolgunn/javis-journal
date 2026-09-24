import { describe, expect, test } from "vitest";

import { nineSliceRects, type NineSlicePiece } from "./nine-slice";
import { FRAMES, FRAME_IDS } from "./spec";

const SCALES = [2, 3, 4];
const BOXES = [
  { w: 390, h: 844 },
  { w: 768, h: 1024 },
  { w: 1440, h: 900 },
];

const by = (pieces: NineSlicePiece[], key: string) =>
  pieces.find((p) => p.key === key)!;

describe.each(FRAME_IDS)("nineSliceRects(%s)", (id) => {
  const spec = FRAMES[id];

  test.each(SCALES)("×%i: the 8 ring cells, no centre", (scale) => {
    const pieces = nineSliceRects(spec, 390, 844, scale);
    expect(pieces).toHaveLength(8);
    expect(pieces.map((p) => p.key).sort()).toEqual(
      ["b", "bl", "br", "l", "r", "t", "tl", "tr"].sort(),
    );
  });

  test.each(SCALES)("×%i: the source rects tile the sheet exactly", (scale) => {
    const pieces = nineSliceRects(spec, 390, 844, scale);

    // Columns: 0 | slice.l | slice.l+period | sheetW — and the same rows, transposed.
    const left = by(pieces, "tl").src;
    const mid = by(pieces, "t").src;
    const right = by(pieces, "tr").src;
    expect(left.x).toBe(0);
    expect(left.x + left.w).toBe(mid.x);
    expect(mid.w).toBe(spec.period);
    expect(mid.x + mid.w).toBe(right.x);
    expect(right.x + right.w).toBe(spec.sheetW);

    const top = by(pieces, "tl").src;
    const midR = by(pieces, "l").src;
    const bottom = by(pieces, "bl").src;
    expect(top.y).toBe(0);
    expect(top.y + top.h).toBe(midR.y);
    expect(midR.h).toBe(spec.period);
    expect(midR.y + midR.h).toBe(bottom.y);
    expect(bottom.y + bottom.h).toBe(spec.sheetH);

    // Nothing samples outside the sheet.
    for (const p of pieces) {
      expect(p.src.x).toBeGreaterThanOrEqual(0);
      expect(p.src.y).toBeGreaterThanOrEqual(0);
      expect(p.src.x + p.src.w).toBeLessThanOrEqual(spec.sheetW);
      expect(p.src.y + p.src.h).toBeLessThanOrEqual(spec.sheetH);
    }
  });

  test.each(BOXES)("the destination rects tile the ring exactly ($w×$h)", ({ w, h }) => {
    for (const scale of SCALES) {
      const pieces = nineSliceRects(spec, w, h, scale);

      // Corners are the SCALED SLICE (not the ink) — that is the whole point of outset.
      const tl = by(pieces, "tl").dst;
      expect(tl).toEqual({
        x: 0,
        y: 0,
        w: spec.slice.l * scale,
        h: spec.slice.t * scale,
      });
      const br = by(pieces, "br").dst;
      expect(br.x + br.w).toBe(w);
      expect(br.y + br.h).toBe(h);

      // Top row spans [0, w] with no gap and no overlap; left column spans [0, h].
      const row = [by(pieces, "tl").dst, by(pieces, "t").dst, by(pieces, "tr").dst];
      let x = 0;
      for (const r of row) {
        expect(r.x).toBe(x);
        x += r.w;
      }
      expect(x).toBe(w);

      const col = [by(pieces, "tl").dst, by(pieces, "l").dst, by(pieces, "bl").dst];
      let y = 0;
      for (const c of col) {
        expect(c.y).toBe(y);
        y += c.h;
      }
      expect(y).toBe(h);

      // Opposite edges agree, so the ring is a ring.
      expect(by(pieces, "b").dst.w).toBe(by(pieces, "t").dst.w);
      expect(by(pieces, "r").dst.h).toBe(by(pieces, "l").dst.h);
    }
  });

  test("edges carry a whole tile count (`round`); corners carry none", () => {
    const pieces = nineSliceRects(spec, 390, 844, 2);
    for (const p of pieces) {
      if (p.key.length === 2) {
        expect(p.tiles).toBeNull(); // tl / tr / bl / br
      } else {
        expect(p.tiles).toBeGreaterThanOrEqual(1);
        expect(Number.isInteger(p.tiles)).toBe(true);
      }
    }
  });

  test("a degenerate box never produces a negative edge run", () => {
    const pieces = nineSliceRects(spec, 4, 4, 4);
    for (const p of pieces) {
      expect(p.tiles === null || p.tiles >= 1).toBe(true);
    }
    // The top edge's run can collapse, but the tile count stays sane for the caller.
    expect(by(pieces, "t").tiles).toBeGreaterThanOrEqual(1);
  });
});

describe("nineSliceRects — per-side widths (the export's stretched ring)", () => {
  test.each(FRAME_IDS)("%s: sideW sets the l/r columns; the ring still tiles exactly", (id) => {
    const spec = FRAMES[id];
    const w = 2104;
    const h = 1200;
    const sideW = { l: spec.slice.l * 4 + 17.5, r: spec.slice.r * 4 + 17.5 };
    const pieces = nineSliceRects(spec, w, h, 4, sideW);
    for (const k of ["tl", "l", "bl"]) expect(by(pieces, k).dst.w).toBe(sideW.l);
    for (const k of ["tr", "r", "br"]) expect(by(pieces, k).dst.w).toBe(sideW.r);
    // Columns still abut: left | top run | right spans exactly the box width.
    expect(by(pieces, "t").dst.x).toBe(sideW.l);
    expect(by(pieces, "tr").dst.x + by(pieces, "tr").dst.w).toBe(w);
    expect(by(pieces, "t").dst.w).toBe(w - sideW.l - sideW.r);
    // Rows are untouched.
    expect(by(pieces, "tl").dst.h).toBe(spec.slice.t * 4);
    // Without sideW nothing changes (the CSS path).
    expect(by(nineSliceRects(spec, w, h, 4), "l").dst.w).toBe(spec.slice.l * 4);
  });
});
