import { describe, expect, test } from "vitest";

import type { Stamp } from "@/lib/db/types";
import {
  PLACEMENT,
  canPlace,
  clampCenter,
  clampScale,
  isInsidePage,
  isTopStamp,
  maxFitScale,
  placeStamp,
  snapRotation,
  toggleFrontBack,
} from "./place";

// The 4 shipped mask aspects (postage 3:4, cloud 1.4, spiky/heart 1:1) + two extremes, so the
// invariants are asserted across the whole space, not the happy path.
const ASPECTS = [3 / 4, 1.4, 1, 0.35, 3];

function stamp(over: Partial<Stamp>): Stamp {
  return {
    id: "s1",
    entry_id: "e1",
    user_id: "u1",
    image_id: "img1",
    mask_type: "heart",
    pos_x: 0.5,
    pos_y: 0.5,
    scale: 0.5,
    rotation_deg: 0,
    layer_order: 0,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    deleted_at: null,
    ...over,
  };
}

/** Grow a day one stamp at a time through placeStamp, as the real flow does. */
function fill(count: number, aspect: number): Stamp[] {
  const out: Stamp[] = [];
  for (let i = 0; i < count; i++) {
    const p = placeStamp(out, aspect);
    if (!p) break;
    out.push(stamp({ id: `s${i}`, image_id: `img${i}`, ...p }));
  }
  return out;
}

describe("placeStamp (ALG-8)", () => {
  test("the first stamp is centered at max-fit", () => {
    for (const aspect of ASPECTS) {
      const p = placeStamp([], aspect);
      expect(p).not.toBeNull();
      expect(p!.pos_x).toBeCloseTo(0.5, 6);
      expect(p!.pos_y).toBeCloseTo(0.5, 6);
      expect(p!.scale).toBeCloseTo(maxFitScale(aspect), 6);
      expect(p!.rotation_deg).toBe(0);
      expect(p!.layer_order).toBe(1);
    }
  });

  test("the 2nd and 3rd stamps are smaller than the first and cascade off-center", () => {
    for (const aspect of ASPECTS) {
      const day = fill(3, aspect);
      expect(day).toHaveLength(3);
      expect(day[1].scale).toBeLessThan(day[0].scale);
      expect(day[2].scale).toBeLessThan(day[0].scale);
      // Each new stamp sits down-right of the previous one (or is clamped to the same edge —
      // never up-left of it), so it can't fully cover what came before.
      expect(day[2].pos_x).toBeGreaterThanOrEqual(day[1].pos_x);
      expect(day[2].pos_y).toBeGreaterThanOrEqual(day[1].pos_y);
      expect(day[1].pos_x).toBeGreaterThan(0.5);
      expect(day[1].pos_y).toBeGreaterThan(0.5);
    }
  });

  test("every placed stamp is fully inside the 8:5 page — the cascade clamp pulls it back", () => {
    for (const aspect of ASPECTS) {
      for (const s of fill(3, aspect)) {
        expect(
          isInsidePage({ x: s.pos_x, y: s.pos_y }, s.scale, aspect, s.rotation_deg),
        ).toBe(true);
      }
    }
  });

  test("newest lands on top", () => {
    const day = fill(3, 1);
    expect(day.map((s) => s.layer_order)).toEqual([1, 2, 3]);
  });

  test("the 4th insert is rejected (3-cap)", () => {
    const day = fill(3, 1);
    expect(canPlace(day)).toBe(false);
    expect(placeStamp(day, 1)).toBeNull();
  });

  test("a tombstoned stamp doesn't count against the cap and frees a slot", () => {
    const day = fill(3, 1);
    const withDelete = [
      ...day.slice(0, 2),
      { ...day[2], deleted_at: "2026-07-02T00:00:00.000Z" },
    ];
    expect(canPlace(withDelete)).toBe(true);
    expect(placeStamp(withDelete, 1)).not.toBeNull();
  });
});

describe("clamps", () => {
  test("clampCenter always yields a box inside the page, from any wild center", () => {
    const wild = [
      { x: -5, y: -5 },
      { x: 9, y: 9 },
      { x: 0, y: 1 },
      { x: 1, y: 0 },
    ];
    for (const aspect of ASPECTS) {
      for (const rot of [0, 45, 90, 135, 180, 225, 270, 315]) {
        const scale = clampScale(0.5, aspect, rot);
        for (const p of wild) {
          const c = clampCenter(p, scale, aspect, rot);
          expect(isInsidePage(c, scale, aspect, rot)).toBe(true);
        }
      }
    }
  });

  test("clampScale never exceeds max-fit at that rotation (so nothing scales off-page)", () => {
    for (const aspect of ASPECTS) {
      for (const rot of [0, 45, 90, 135]) {
        const s = clampScale(99, aspect, rot);
        expect(s).toBeCloseTo(maxFitScale(aspect, rot, 0), 6);
        const c = clampCenter({ x: 0.5, y: 0.5 }, s, aspect, rot);
        expect(isInsidePage(c, s, aspect, rot)).toBe(true);
      }
    }
  });

  test("clampScale floors a pinch-to-nothing at MIN_SCALE", () => {
    expect(clampScale(0.0001, 1, 0)).toBeCloseTo(PLACEMENT.MIN_SCALE, 6);
  });
});

describe("snapRotation", () => {
  test("lands only on the 8 legal rotation_deg values", () => {
    const legal = [0, 45, 90, 135, 180, 225, 270, 315];
    for (let deg = -720; deg <= 720; deg += 7) {
      expect(legal).toContain(snapRotation(deg));
    }
  });

  test("snaps to the nearest 45°", () => {
    expect(snapRotation(20)).toBe(0);
    expect(snapRotation(25)).toBe(45);
    expect(snapRotation(-10)).toBe(0);
    expect(snapRotation(359)).toBe(0);
    expect(snapRotation(200)).toBe(180);
  });
});

describe("front/back tap toggle", () => {
  const day = [
    stamp({ id: "a", layer_order: 1 }),
    stamp({ id: "b", layer_order: 2 }),
    stamp({ id: "c", layer_order: 3 }),
  ];

  test("a tap on a buried stamp brings it to the front (max+1)", () => {
    expect(isTopStamp(day, "a")).toBe(false);
    expect(toggleFrontBack(day, "a")).toBe(4);
  });

  test("a tap on the top stamp sends it to the back (min−1)", () => {
    expect(isTopStamp(day, "c")).toBe(true);
    expect(toggleFrontBack(day, "c")).toBe(0);
  });

  test("two toggles on the same stamp return it to the top", () => {
    const front = toggleFrontBack(day, "a");
    const next = day.map((s) => (s.id === "a" ? { ...s, layer_order: front } : s));
    expect(isTopStamp(next, "a")).toBe(true);
    // …and a second tap sends it back under everything else (below b's layer 2).
    const back = toggleFrontBack(next, "a");
    expect(back).toBeLessThan(2);
    const final = next.map((s) => (s.id === "a" ? { ...s, layer_order: back } : s));
    expect(isTopStamp(final, "a")).toBe(false);
  });
});
