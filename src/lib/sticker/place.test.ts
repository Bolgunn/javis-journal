// The sticker pure layer (M7 DoD, Tier 1). The rules under test are the promises US-9 makes:
//   · a tapped sticker lands where she is LOOKING (the visible center), never off-screen
//   · nothing can be dragged, pinched or twisted off the day-grid box — at any rotation
//   · repeat taps cascade instead of stacking into one invisible pile
//   · rotation only ever lands on the 8 legal `rotation_deg` values
//   · the 51st sticker on a month is refused
//
// Every assertion is an INVARIANT, never a literal constant — retuning STICKER must not
// break a single test here.

import { describe, expect, test } from "vitest";

import { CELL_ASPECT_RATIO } from "@/lib/calendar/fit";
import type { PlacedSticker, RotationDeg } from "@/lib/db/types";
import {
  GRID_ASPECT,
  STICKER,
  canPlace,
  clampCenter,
  clampScale,
  isInsideGrid,
  placeSticker,
  snapRotation,
  toggleFrontBack,
} from "./place";

const ROTATIONS: RotationDeg[] = [0, 45, 90, 135, 180, 225, 270, 315];
const ASPECTS = [0.5, 1, 1.6, 2.4];

function sticker(over: Partial<PlacedSticker> = {}): PlacedSticker {
  return {
    id: "s1",
    user_id: "u1",
    image_id: "img1",
    sticker_asset_id: "a1",
    year_month: "2026-07",
    pos_x: 0.5,
    pos_y: 0.5,
    scale: STICKER.DEFAULT_SCALE,
    rotation_deg: 0,
    layer_order: 1,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    deleted_at: null,
    ...over,
  };
}

describe("the grid box", () => {
  test("its aspect is DERIVED from the cell's (7·cellW / 6·cellH), never hardcoded", () => {
    expect(GRID_ASPECT).toBeCloseTo((7 * CELL_ASPECT_RATIO) / 6, 10);
    expect(GRID_ASPECT).toBeCloseTo(28 / 15, 10);
  });
});

describe("placement", () => {
  test("a tapped sticker lands at the point she is looking at", () => {
    const p = placeSticker([], 1, { x: 0.25, y: 0.3 });
    expect(p).not.toBeNull();
    expect(p!.pos_x).toBeCloseTo(0.25, 6);
    expect(p!.pos_y).toBeCloseTo(0.3, 6);
  });

  test("it enters about one day cell wide, and always inside the grid", () => {
    for (const aspect of ASPECTS) {
      const p = placeSticker([], aspect, { x: 0.5, y: 0.5 })!;
      expect(p.scale).toBeLessThanOrEqual(STICKER.MAX_SCALE);
      expect(p.scale).toBeGreaterThanOrEqual(STICKER.MIN_SCALE);
      expect(isInsideGrid({ x: p.pos_x, y: p.pos_y }, p.scale, aspect, p.rotation_deg)).toBe(
        true,
      );
    }
  });

  test("a tap at the very corner is pulled fully inside the grid, not clipped by it", () => {
    for (const corner of [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ]) {
      for (const aspect of ASPECTS) {
        const p = placeSticker([], aspect, corner)!;
        expect(isInsideGrid({ x: p.pos_x, y: p.pos_y }, p.scale, aspect, 0)).toBe(true);
      }
    }
  });

  test("repeat taps cascade — three stamps of the same sticker are three distinct spots", () => {
    const wanted = { x: 0.5, y: 0.5 };
    const placed: PlacedSticker[] = [];

    for (let i = 0; i < 3; i++) {
      const p = placeSticker(placed, 1, wanted)!;
      placed.push(sticker({ id: `s${i}`, ...p }));
    }

    const centers = placed.map((s) => `${s.pos_x.toFixed(4)},${s.pos_y.toFixed(4)}`);
    expect(new Set(centers).size).toBe(3);
    // …and each is still on the grid, and on top of the last.
    for (const s of placed) {
      expect(isInsideGrid({ x: s.pos_x, y: s.pos_y }, s.scale, 1, 0)).toBe(true);
    }
    expect(placed[1].layer_order).toBeGreaterThan(placed[0].layer_order);
    expect(placed[2].layer_order).toBeGreaterThan(placed[1].layer_order);
  });

  test("a sticker somewhere else does not push a new one off its spot", () => {
    const elsewhere = [sticker({ pos_x: 0.9, pos_y: 0.1 })];
    const p = placeSticker(elsewhere, 1, { x: 0.3, y: 0.6 })!;
    expect(p.pos_x).toBeCloseTo(0.3, 6);
    expect(p.pos_y).toBeCloseTo(0.6, 6);
  });

  test("the newest sticker is on top", () => {
    const existing = [sticker({ id: "a", layer_order: 4 }), sticker({ id: "b", layer_order: 9 })];
    expect(placeSticker(existing, 1, { x: 0.5, y: 0.5 })!.layer_order).toBe(10);
  });

  test("the cap: the 51st sticker on a month is refused, and nothing is written", () => {
    const full = Array.from({ length: STICKER.MAX_PER_MONTH }, (_, i) =>
      sticker({ id: `s${i}`, layer_order: i }),
    );
    expect(canPlace(full)).toBe(false);
    expect(placeSticker(full, 1, { x: 0.5, y: 0.5 })).toBeNull();

    // A tombstoned sticker frees a slot — the cap counts LIVE stickers.
    const withDeleted = [...full.slice(1), sticker({ id: "gone", deleted_at: "2026-07-02" })];
    expect(canPlace(withDeleted)).toBe(true);
    expect(placeSticker(withDeleted, 1, { x: 0.5, y: 0.5 })).not.toBeNull();
  });
});

describe("clamps — nothing leaves the grid box", () => {
  test("clampCenter pulls any out-of-bounds center back inside, at every rotation", () => {
    const far = [
      { x: -3, y: -3 },
      { x: 4, y: 4 },
      { x: 0.5, y: -0.2 },
      { x: 1.4, y: 0.5 },
    ];
    for (const aspect of ASPECTS) {
      for (const rot of ROTATIONS) {
        const scale = clampScale(STICKER.MAX_SCALE, aspect, rot);
        for (const pos of far) {
          const c = clampCenter(pos, scale, aspect, rot);
          expect(isInsideGrid(c, scale, aspect, rot)).toBe(true);
        }
      }
    }
  });

  test("clampScale honours [MIN_SCALE, MAX_SCALE] and never lets a rotated sticker overhang", () => {
    for (const aspect of ASPECTS) {
      for (const rot of ROTATIONS) {
        const big = clampScale(99, aspect, rot);
        expect(big).toBeLessThanOrEqual(STICKER.MAX_SCALE + 1e-9);
        expect(isInsideGrid(clampCenter({ x: 0.5, y: 0.5 }, big, aspect, rot), big, aspect, rot))
          .toBe(true);

        const tiny = clampScale(0.0001, aspect, rot);
        expect(tiny).toBeGreaterThanOrEqual(Math.min(STICKER.MIN_SCALE, big) - 1e-9);
      }
    }
  });
});

describe("rotation", () => {
  test("a twist only ever snaps to one of the 8 legal rotation_deg values", () => {
    for (let deg = -720; deg <= 720; deg += 7) {
      expect(ROTATIONS).toContain(snapRotation(deg));
    }
  });

  test("it snaps to the NEAREST legal value", () => {
    expect(snapRotation(1)).toBe(0);
    expect(snapRotation(44)).toBe(45);
    expect(snapRotation(359)).toBe(0);
    expect(snapRotation(-45)).toBe(315);
  });
});

describe("front/back", () => {
  test("a buried sticker comes to the front; the top one goes to the back", () => {
    const layer = [
      sticker({ id: "a", layer_order: 1 }),
      sticker({ id: "b", layer_order: 2 }),
      sticker({ id: "c", layer_order: 3 }),
    ];
    expect(toggleFrontBack(layer, "a")).toBe(4); // buried → front
    expect(toggleFrontBack(layer, "c")).toBe(0); // on top → back
  });
});
