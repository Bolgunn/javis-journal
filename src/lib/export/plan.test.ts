import { describe, expect, test } from "vitest";

import { monthGrid } from "@/lib/calendar/month-grid";
import type { PlacedSticker, SelectedFrame, Stamp } from "@/lib/db/types";
import { stampBoxes } from "@/lib/day/layout";
import { stickerBoxes } from "@/lib/sticker/layout";
import { CELL_ASPECT_RATIO } from "@/lib/calendar/fit";
import { FRAME_MAT, FRAMES } from "@/lib/frames/spec";
import {
  buildExportPlan,
  EXPORT,
  exportDimensions,
  exportImageIds,
  stretchedSideW,
  type DrawOp,
  type ExportPlanInput,
} from "./plan";

const FRAMES_ALL: SelectedFrame[] = ["rse", "hgss_15", "hgss_18", "none"];

function stamp(over: Partial<Stamp>): Stamp {
  return {
    id: "s1",
    entry_id: "e1",
    user_id: "u",
    image_id: "img-stamp",
    mask_type: "circle",
    pos_x: 0.5,
    pos_y: 0.5,
    scale: 0.5,
    rotation_deg: 0,
    layer_order: 0,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    deleted_at: null,
    ...over,
  };
}

function sticker(over: Partial<PlacedSticker>): PlacedSticker {
  return {
    id: "k1",
    user_id: "u",
    image_id: "img-sticker",
    sticker_asset_id: "a1",
    year_month: "2026-07",
    pos_x: 0.4,
    pos_y: 0.4,
    scale: 0.2,
    rotation_deg: 45,
    layer_order: 0,
    created_at: "2026-07-01T00:00:00Z",
    updated_at: "2026-07-01T00:00:00Z",
    deleted_at: null,
    ...over,
  };
}

function baseInput(over: Partial<ExportPlanInput> = {}): ExportPlanInput {
  return {
    year: 2026,
    month: 7,
    weekStart: 1,
    frame: "rse",
    includeTitle: true,
    stampsByDate: new Map(),
    stickers: [],
    aspects: new Map(),
    ...over,
  };
}

const cellOps = (ops: DrawOp[]) =>
  ops.filter((o): o is Extract<DrawOp, { kind: "cell" }> => o.kind === "cell");
const stampOps = (ops: DrawOp[]) =>
  ops.filter((o): o is Extract<DrawOp, { kind: "stamp" }> => o.kind === "stamp");
const stickerOps = (ops: DrawOp[]) =>
  ops.filter((o): o is Extract<DrawOp, { kind: "sticker" }> => o.kind === "sticker");

const frameOps = (ops: DrawOp[]) =>
  ops.filter((o): o is Extract<DrawOp, { kind: "frame" }> => o.kind === "frame");

const CASES = FRAMES_ALL.flatMap((frame) => [
  { frame, includeTitle: true },
  { frame, includeTitle: false },
]);

describe("exportDimensions — the month laid out on a 2160×1350 post", () => {
  test.each(CASES)("$frame, title $includeTitle: the post is exactly 2160×1350", (c) => {
    const d = exportDimensions(c.frame, c.includeTitle);
    expect(d.width).toBe(2160);
    expect(d.height).toBe(1350);
    const plan = buildExportPlan(baseInput(c));
    expect([plan.width, plan.height, plan.sliceW]).toEqual([2160, 1350, 1080]);
  });

  test.each(CASES)("$frame, title $includeTitle: 8:5 cells, as big as fit", (c) => {
    const d = exportDimensions(c.frame, c.includeTitle);
    expect(Number.isInteger(d.cellW)).toBe(true);
    expect(d.cellW / d.cellH).toBeCloseTo(CELL_ASPECT_RATIO, 12);
    expect(d.gridW).toBe(7 * d.cellW);
    expect(d.gridH).toBeCloseTo(6 * d.cellH, 9);

    // Everything fits inside the post with at least the outer margin on every side…
    const M = EXPORT.OUTER_MARGIN;
    expect(d.framedX).toBeGreaterThanOrEqual(M);
    expect(d.framedX + d.framedW).toBeLessThanOrEqual(2160 - M);
    expect(d.titleY).toBeGreaterThanOrEqual(M - 1e-9);
    expect(d.framedY + d.framedH).toBeLessThanOrEqual(1350 - M + 1e-9);
    // …and one more px of cell would not (the binding bound is used, not a guess).
    const availW = 2160 - 2 * M - 2 * d.inset.w;
    const availH = 1350 - 2 * M - d.titleH - EXPORT.HEADER_H - 2 * d.inset.h;
    const bigger = d.cellW + 1;
    expect(7 * bigger > availW || (6 * bigger) / CELL_ASPECT_RATIO > availH).toBe(true);
  });

  test.each(CASES)("$frame, title $includeTitle: the grid is centred on the cut", (c) => {
    const d = exportDimensions(c.frame, c.includeTitle);
    expect(d.gridX + d.gridW / 2).toBeCloseTo(EXPORT.SLICE_W, 9);
    // So x = 1080 falls in the middle of column 4 (index 3) — decision 6.
    expect(d.gridX + 3.5 * d.cellW).toBeCloseTo(EXPORT.SLICE_W, 9);
  });

  test.each(CASES)("$frame, title $includeTitle: the side leftover is exactly the stretch", (c) => {
    const d = exportDimensions(c.frame, c.includeTitle);
    expect(d.sideStretch).toBeGreaterThanOrEqual(0);
    // Ring+mat + stretch on each side, plus the grid, is exactly the framed (full-width) box.
    expect(2 * (d.inset.w + d.sideStretch) + d.gridW).toBeCloseTo(d.framedW, 9);
  });

  test("dropping the title never shrinks the cells", () => {
    for (const frame of FRAMES_ALL) {
      expect(exportDimensions(frame, false).cellW).toBeGreaterThanOrEqual(
        exportDimensions(frame, true).cellW,
      );
    }
  });

  test("'none' frame adds no ring or mat", () => {
    const none = exportDimensions("none", true);
    expect(none.inset).toEqual({ w: 0, h: 0 });
    expect(none.gridX).toBe(EXPORT.OUTER_MARGIN + none.sideStretch);
  });

  test("scale steps to ×4 at export resolution", () => {
    for (const c of CASES) expect(exportDimensions(c.frame, c.includeTitle).scale).toBe(4);
  });
});

describe("buildExportPlan — the ring spans the post and hugs the grid", () => {
  test.each(["rse", "hgss_15", "hgss_18"] as const)(
    "%s: side edges widen by exactly the leftover, the mat stays screen-width",
    (frame) => {
      for (const includeTitle of [true, false]) {
        const d = exportDimensions(frame, includeTitle);
        const spec = FRAMES[frame];
        const pieces = frameOps(buildExportPlan(baseInput({ frame, includeTitle })).ops).map(
          (o) => o.piece,
        );
        const byKey = (k: string) => pieces.find((p) => p.key === k)!.dst;

        // The ring's outer box is the full-width framed box.
        expect(byKey("tl").x).toBeCloseTo(d.framedX, 9);
        expect(byKey("tr").x + byKey("tr").w).toBeCloseTo(d.framedX + d.framedW, 9);

        const l = byKey("l");
        const r = byKey("r");
        expect(l.w).toBeCloseTo(
          stretchedSideW(spec.slice.l, spec.ink.l, d.scale, d.sideStretch),
          9,
        );
        expect(r.w).toBeCloseTo(
          stretchedSideW(spec.slice.r, spec.ink.r, d.scale, d.sideStretch),
          9,
        );

        // The ink band (the outer ink/slice of the column) widened by exactly the leftover…
        const inkL = (l.w * spec.ink.l) / spec.slice.l;
        const inkR = (r.w * spec.ink.r) / spec.slice.r;
        expect(inkL).toBeCloseTo(spec.ink.l * d.scale + d.sideStretch, 9);
        expect(inkR).toBeCloseTo(spec.ink.r * d.scale + d.sideStretch, 9);
        // …so its inner edge sits exactly one mat away from the grid, as on screen.
        expect(d.gridX - (d.framedX + inkL)).toBeCloseTo(FRAME_MAT * d.scale, 9);
        expect(d.framedX + d.framedW - inkR - (d.gridX + d.gridW)).toBeCloseTo(
          FRAME_MAT * d.scale,
          9,
        );

        // Top/bottom are untouched: the ring hugs the header + grid vertically too.
        expect(byKey("t").h).toBe(spec.slice.t * d.scale);
        expect(byKey("b").h).toBe(spec.slice.b * d.scale);
      }
    },
  );

  test("'none' draws no ring", () => {
    for (const includeTitle of [true, false]) {
      const plan = buildExportPlan(baseInput({ frame: "none", includeTitle }));
      expect(frameOps(plan.ops)).toHaveLength(0);
      expect(plan.frameSrc).toBeNull();
    }
  });
});

describe("buildExportPlan — cells", () => {
  test("emits exactly 42 cell ops that tile the grid without gap or overlap", () => {
    const dims = exportDimensions("rse", true);
    const ops = buildExportPlan(baseInput()).ops;
    const cells = cellOps(ops);
    expect(cells).toHaveLength(42);

    for (let i = 0; i < 42; i++) {
      const col = i % 7;
      const row = Math.floor(i / 7);
      const c = cells[i];
      expect(c.x).toBeCloseTo(dims.gridX + col * dims.cellW, 9);
      expect(c.y).toBeCloseTo(dims.gridY + row * dims.cellH, 9);
      expect(c.w).toBe(dims.cellW);
      expect(c.h).toBe(dims.cellH);
    }
    // The union spans exactly the grid rect.
    expect(cells[0].x).toBe(dims.gridX);
    expect(cells[0].y).toBe(dims.gridY);
    const last = cells[41];
    expect(last.x + last.w).toBeCloseTo(dims.gridX + dims.gridW, 9);
    expect(last.y + last.h).toBeCloseTo(dims.gridY + dims.gridH, 9);
  });

  test("blank leading/trailing cells match monthGrid for Mon and Sun starts", () => {
    for (const weekStart of [1, 7]) {
      const grid = monthGrid(2026, 7, weekStart);
      const cells = cellOps(buildExportPlan(baseInput({ weekStart })).ops);
      grid.forEach((cell, i) => {
        expect(cells[i].blank).toBe(cell === null);
      });
    }
  });
});

describe("buildExportPlan — stamps & stickers reuse the shared layout", () => {
  test("stamp rects equal stampBoxes offset into their cell", () => {
    // July 1, 2026 is a Wednesday → Mon-start index 2 (row 0, col 2).
    const stamps = [stamp({ id: "a", pos_x: 0.5, pos_y: 0.5, scale: 0.4 })];
    const aspects = new Map([["img-stamp", 1.5]]);
    const input = baseInput({
      stampsByDate: new Map([["2026-07-01", stamps]]),
      aspects,
    });
    const dims = exportDimensions("rse", true);
    const grid = monthGrid(2026, 7, 1);
    const idx = grid.findIndex((c) => c?.date === "2026-07-01");
    const col = idx % 7;
    const row = Math.floor(idx / 7);
    const cellX = dims.gridX + col * dims.cellW;
    const cellY = dims.gridY + row * dims.cellH;

    const expected = stampBoxes(stamps, aspects, dims.cellW)[0];
    const op = stampOps(buildExportPlan(input).ops)[0];
    expect(op.imageId).toBe("img-stamp");
    expect(op.box.x).toBeCloseTo(cellX + expected.x, 6);
    expect(op.box.y).toBeCloseTo(cellY + expected.y, 6);
    expect(op.box.w).toBeCloseTo(expected.w, 6);
    expect(op.box.h).toBeCloseTo(expected.h, 6);
    expect(op.box.cx).toBeCloseTo(cellX + expected.cx, 6);
    expect(op.box.cy).toBeCloseTo(cellY + expected.cy, 6);
    expect(op.box.rot).toBe(expected.rot);
  });

  test("sticker rects equal stickerBoxes offset by the grid origin", () => {
    const stickers = [sticker({ id: "k", pos_x: 0.4, pos_y: 0.4, scale: 0.2 })];
    const aspects = new Map([["img-sticker", 1]]);
    const dims = exportDimensions("rse", true);
    const expected = stickerBoxes(stickers, aspects, dims.gridW)[0];
    const op = stickerOps(buildExportPlan(baseInput({ stickers, aspects })).ops)[0];
    expect(op.box.x).toBeCloseTo(dims.gridX + expected.x, 6);
    expect(op.box.y).toBeCloseTo(dims.gridY + expected.y, 6);
    expect(op.box.cx).toBeCloseTo(dims.gridX + expected.cx, 6);
    expect(op.box.cy).toBeCloseTo(dims.gridY + expected.cy, 6);
    expect(op.box.rot).toBe(expected.rot);
  });

  test("deleted stamps/stickers are not drawn", () => {
    const input = baseInput({
      stampsByDate: new Map([
        ["2026-07-01", [stamp({ id: "gone", deleted_at: "2026-07-02T00:00:00Z" })]],
      ]),
      stickers: [sticker({ id: "gone2", deleted_at: "2026-07-02T00:00:00Z" })],
    });
    const ops = buildExportPlan(input).ops;
    expect(stampOps(ops)).toHaveLength(0);
    expect(stickerOps(ops)).toHaveLength(0);
  });
});

describe("buildExportPlan — draw order for the render taint canary", () => {
  test("only stamps and stickers carry an imageId, and they come after frame, before title", () => {
    const input = baseInput({
      stampsByDate: new Map([["2026-07-01", [stamp({ id: "a" })]]]),
      stickers: [sticker({ id: "k" })],
      aspects: new Map([
        ["img-stamp", 1],
        ["img-sticker", 1],
      ]),
    });
    const kinds = buildExportPlan(input).ops.map((o) => o.kind);
    const iFrame = kinds.indexOf("frame");
    const iStamp = kinds.indexOf("stamp");
    const iSticker = kinds.indexOf("sticker");
    const iTitle = kinds.indexOf("title");
    expect(iFrame).toBeGreaterThanOrEqual(0);
    expect(iFrame).toBeLessThan(iStamp);
    expect(iStamp).toBeLessThan(iSticker);
    expect(iSticker).toBeLessThan(iTitle);
  });
});

describe("buildExportPlan — the today-exclusion guard (decision 3)", () => {
  test("no op represents a today marker, and the plan does not depend on the real clock", () => {
    // The current real month per the session (2026-07). The exported plan for July must be a pure
    // function of {year, month}; there is no 'today' op kind and no per-cell today flag anywhere.
    const july = buildExportPlan(baseInput({ year: 2026, month: 7 }));
    const kinds = new Set(july.ops.map((o) => o.kind));
    expect(kinds.has("cell")).toBe(true);
    // The only op kinds that exist — none of them is a today disc.
    for (const k of kinds) {
      expect([
        "background",
        "frame",
        "cell",
        "hairline",
        "weekday",
        "stamp",
        "dayNumber",
        "sticker",
        "title",
      ]).toContain(k);
    }
    // A cell op carries only geometry + blank — never an isToday distinction.
    for (const c of cellOps(july.ops)) {
      expect(Object.keys(c).sort()).toEqual(["blank", "h", "kind", "w", "x", "y"]);
    }
  });

  test("exporting a non-current (past) viewed month yields that month's grid, clock-independent", () => {
    // Build the same March plan twice — the function reads no wall clock, so they are identical.
    const a = buildExportPlan(baseInput({ month: 3 }));
    const b = buildExportPlan(baseInput({ month: 3 }));
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // And it is genuinely March's grid, not July's.
    const marchBlanks = monthGrid(2026, 3, 1).map((c) => c === null);
    expect(cellOps(a.ops).map((c) => c.blank)).toEqual(marchBlanks);
  });
});

describe("exportImageIds", () => {
  test("splits stamp vs sticker ids and dedupes, skipping deleted", () => {
    const input = {
      stampsByDate: new Map([
        ["2026-07-01", [stamp({ id: "a", image_id: "s1" }), stamp({ id: "b", image_id: "s1" })]],
        ["2026-07-02", [stamp({ id: "c", image_id: "s2", deleted_at: "x" })]],
      ]),
      stickers: [
        sticker({ id: "k", image_id: "p1" }),
        sticker({ id: "k2", image_id: "p1" }),
        sticker({ id: "k3", image_id: "p2", deleted_at: "x" }),
      ],
    };
    const ids = exportImageIds(input);
    expect(ids.stamps).toEqual(["s1"]);
    expect(ids.stickers).toEqual(["p1"]);
  });
});
