import { describe, expect, test } from "vitest";

import type { Stamp } from "@/lib/db/types";
import { PAGE_ASPECT, placeStamp } from "./place";
import { pageHeight, stampBoxes } from "./layout";
import { topElementAt } from "./hit";

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
    layer_order: 1,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    deleted_at: null,
    ...over,
  };
}

const aspects = new Map([
  ["img1", 1],
  ["img2", 3 / 4],
]);

describe("stampBoxes", () => {
  test("scale is the width as a fraction of the page; height follows the baked aspect", () => {
    const [box] = stampBoxes([stamp({ scale: 0.5, image_id: "img2" })], aspects, 700);
    expect(box.w).toBeCloseTo(350, 6);
    expect(box.h).toBeCloseTo(350 / (3 / 4), 6);
  });

  test("pos is the CENTER, normalized to the 8:5 page", () => {
    const pageW = 700;
    const [box] = stampBoxes([stamp({ pos_x: 0.5, pos_y: 0.5, scale: 0.5 })], aspects, pageW);
    expect(box.cx).toBeCloseTo(pageW / 2, 6);
    expect(box.cy).toBeCloseTo(pageHeight(pageW) / 2, 6);
    expect(box.x).toBeCloseTo(box.cx - box.w / 2, 6);
    expect(box.y).toBeCloseTo(box.cy - box.h / 2, 6);
  });

  test("the same composition at two pixel sizes is a pure rescale (cell == page)", () => {
    const day = [
      stamp({ id: "a", layer_order: 1, scale: 0.4, pos_x: 0.3, pos_y: 0.4 }),
      stamp({ id: "b", layer_order: 2, scale: 0.3, pos_x: 0.7, pos_y: 0.6, image_id: "img2" }),
    ];
    const page = stampBoxes(day, aspects, 700);
    const cell = stampBoxes(day, aspects, 70);
    page.forEach((p, i) => {
      expect(cell[i].x).toBeCloseTo(p.x / 10, 6);
      expect(cell[i].y).toBeCloseTo(p.y / 10, 6);
      expect(cell[i].w).toBeCloseTo(p.w / 10, 6);
      expect(cell[i].rot).toBe(p.rot);
    });
  });

  test("orders back-to-front by layer_order and drops tombstones", () => {
    const boxes = stampBoxes(
      [
        stamp({ id: "top", layer_order: 5 }),
        stamp({ id: "gone", layer_order: 9, deleted_at: "2026-07-02T00:00:00.000Z" }),
        stamp({ id: "bottom", layer_order: 1 }),
      ],
      aspects,
      700,
    );
    expect(boxes.map((b) => b.id)).toEqual(["bottom", "top"]);
  });

  test("the page is 8:5", () => {
    expect(700 / pageHeight(700)).toBeCloseTo(PAGE_ASPECT, 9);
  });
});

describe("topElementAt (hit-testing)", () => {
  const pageW = 700;

  test("picks the highest layer_order under the point", () => {
    const boxes = stampBoxes(
      [stamp({ id: "under", layer_order: 1 }), stamp({ id: "over", layer_order: 2 })],
      aspects,
      pageW,
    );
    const hit = topElementAt({ x: pageW / 2, y: pageHeight(pageW) / 2 }, boxes);
    expect(hit?.id).toBe("over");
  });

  test("a tap on empty page space hits nothing (→ deselect)", () => {
    const boxes = stampBoxes([stamp({ scale: 0.2 })], aspects, pageW);
    expect(topElementAt({ x: 5, y: 5 }, boxes)).toBeNull();
  });

  test("a tap outside a 45°-rotated stamp's rotated box misses it (elementFromPoint would not)", () => {
    // The motivating case: a heart stamp rotated 45° — its unrotated DOM rect still covers the
    // corner, but the rotated box does not, so the stamp UNDERNEATH must win the tap.
    const under = stamp({ id: "under", layer_order: 1, scale: 0.8, rotation_deg: 0 });
    const over = stamp({ id: "over", layer_order: 2, scale: 0.4, rotation_deg: 45 });
    const boxes = stampBoxes([under, over], aspects, pageW);
    const top = boxes.find((b) => b.id === "over")!;

    // A point just inside the top-left corner of `over`'s AXIS-ALIGNED rect: outside the
    // rotated diamond, inside the stamp below it.
    const corner = { x: top.cx - top.w / 2 + 2, y: top.cy - top.h / 2 + 2 };
    expect(topElementAt(corner, boxes)?.id).toBe("under");
    // …while its center still hits the top stamp.
    expect(topElementAt({ x: top.cx, y: top.cy }, boxes)?.id).toBe("over");
  });

  test("hit-testing agrees with placement: the first stamp's center is hittable", () => {
    const p = placeStamp([], 1)!;
    const boxes = stampBoxes([stamp({ ...p })], aspects, pageW);
    expect(topElementAt({ x: boxes[0].cx, y: boxes[0].cy }, boxes)?.id).toBe("s1");
  });
});
