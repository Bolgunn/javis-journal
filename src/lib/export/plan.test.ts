import { describe, expect, test } from "vitest";

import { monthGrid } from "@/lib/calendar/month-grid";
import type { PlacedSticker, SelectedFrame, Stamp } from "@/lib/db/types";
import { stampBoxes } from "@/lib/day/layout";
import { stickerBoxes } from "@/lib/sticker/layout";
import { frameBoxInsets, frameScale } from "@/lib/frames/spec";
import {
  buildExportPlan,
  EXPORT,
  EXPORT_CELL_H,
  EXPORT_GRID_H,
  EXPORT_GRID_W,
  exportDimensions,
  exportImageIds,
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

describe("exportDimensions", () => {
  test("grid geometry constants are the derived 8:5 box", () => {
    expect(EXPORT_CELL_H).toBe(157.5);
    expect(EXPORT_GRID_W).toBe(1764);
    expect(EXPORT_GRID_H).toBe(945);
  });

  test.each(FRAMES_ALL)("%s: outer size = grid + ring + mat + margin (+title)", (frame) => {
    const scale = frameScale(EXPORT_GRID_W);
    const inset = frameBoxInsets(frame, scale);
    const framedW = EXPORT_GRID_W + 2 * inset.w;
    const framedH = EXPORT.HEADER_H + EXPORT_GRID_H + 2 * inset.h;

    const withTitle = exportDimensions(frame, true);
    expect(withTitle.width).toBe(framedW + 2 * EXPORT.OUTER_MARGIN);
    expect(withTitle.height).toBe(
      EXPORT.TITLE_BAND_H + framedH + 2 * EXPORT.OUTER_MARGIN,
    );

    const noTitle = exportDimensions(frame, false);
    expect(noTitle.width).toBe(withTitle.width);
    // Dropping the title removes exactly the band height.
    expect(withTitle.height - noTitle.height).toBe(EXPORT.TITLE_BAND_H);
  });

  test("'none' frame adds no ring or mat (width bit-identical to bare grid + margin)", () => {
    const none = exportDimensions("none", false);
    expect(none.width).toBe(EXPORT_GRID_W + 2 * EXPORT.OUTER_MARGIN);
    expect(none.gridX).toBe(EXPORT.OUTER_MARGIN);
  });

  test("scale steps to ×4 at export resolution", () => {
    expect(exportDimensions("rse", true).scale).toBe(4);
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
      expect(c.x).toBe(dims.gridX + col * EXPORT.CELL_W);
      expect(c.y).toBe(dims.gridY + row * EXPORT_CELL_H);
      expect(c.w).toBe(EXPORT.CELL_W);
      expect(c.h).toBe(EXPORT_CELL_H);
    }
    // The union spans exactly the grid rect.
    expect(cells[0].x).toBe(dims.gridX);
    expect(cells[0].y).toBe(dims.gridY);
    const last = cells[41];
    expect(last.x + last.w).toBe(dims.gridX + EXPORT_GRID_W);
    expect(last.y + last.h).toBe(dims.gridY + EXPORT_GRID_H);
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
    const cellX = dims.gridX + col * EXPORT.CELL_W;
    const cellY = dims.gridY + row * EXPORT_CELL_H;

    const expected = stampBoxes(stamps, aspects, EXPORT.CELL_W)[0];
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
    const expected = stickerBoxes(stickers, aspects, EXPORT_GRID_W)[0];
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
