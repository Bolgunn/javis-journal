import { describe, expect, test } from "vitest";

import type { PlacedSticker, Stamp } from "@/lib/db/types";
import { buildExportPlan, type ExportPlanInput } from "./plan";
import { renderExport, type ExportBitmaps, type ExportTokens } from "./render";

// A brand so the taint canary can prove every drawImage arg is a "decoded bitmap" and never an
// HTMLImageElement / URL string. In the browser these are real `ImageBitmap`s; in this DOM-less
// runner we stand in tagged objects and assert drawImage only ever sees them.
type FakeBitmap = { __bitmap: string };
const bitmap = (tag: string): FakeBitmap => ({ __bitmap: tag });

type Call = { method: string; args: unknown[] };

function recordingCanvas() {
  const calls: Call[] = [];
  const ctx = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "canvas") return canvas;
        // Properties the code assigns to (fillStyle, font, …) must be settable no-ops.
        return (...args: unknown[]) => {
          calls.push({ method: prop, args });
        };
      },
      set() {
        return true;
      },
    },
  ) as unknown as OffscreenCanvasRenderingContext2D;

  const canvas = {
    getContext: () => ctx,
    convertToBlob: async () => new Blob(["png"], { type: "image/png" }),
  } as unknown as OffscreenCanvas;

  return { canvas, calls };
}

function stamp(over: Partial<Stamp>): Stamp {
  return {
    id: "s",
    entry_id: "e",
    user_id: "u",
    image_id: "img-stamp",
    mask_type: "circle",
    pos_x: 0.5,
    pos_y: 0.5,
    scale: 0.4,
    rotation_deg: 45,
    layer_order: 0,
    created_at: "x",
    updated_at: "x",
    deleted_at: null,
    ...over,
  };
}

function sticker(over: Partial<PlacedSticker>): PlacedSticker {
  return {
    id: "k",
    user_id: "u",
    image_id: "img-sticker",
    sticker_asset_id: "a",
    year_month: "2026-07",
    pos_x: 0.4,
    pos_y: 0.4,
    scale: 0.2,
    rotation_deg: 45,
    layer_order: 0,
    created_at: "x",
    updated_at: "x",
    deleted_at: null,
    ...over,
  };
}

function input(over: Partial<ExportPlanInput> = {}): ExportPlanInput {
  return {
    year: 2026,
    month: 7,
    weekStart: 1,
    frame: "rse",
    includeTitle: true,
    stampsByDate: new Map([["2026-07-01", [stamp({})]]]),
    stickers: [sticker({})],
    aspects: new Map([
      ["img-stamp", 1.5],
      ["img-sticker", 1],
    ]),
    ...over,
  };
}

const TOKENS: ExportTokens = {
  paper: "#fffdf8",
  line: "#eadad1",
  lineSoft: "#f2e6df",
  ink: "#3b332f",
  fontTitle: "Georgia, serif",
  fontBody: "system-ui, sans-serif",
};

function bitmaps(over: Partial<ExportBitmaps> = {}): ExportBitmaps {
  return {
    frame: bitmap("frame") as unknown as ImageBitmap,
    stamps: new Map([["img-stamp", bitmap("stamp") as unknown as ImageBitmap]]),
    stickers: new Map([["img-sticker", bitmap("sticker") as unknown as ImageBitmap]]),
    ...over,
  };
}

const drawImageArgs = (calls: Call[]) =>
  calls.filter((c) => c.method === "drawImage").map((c) => c.args[0]);

describe("renderExport", () => {
  test("returns a PNG blob", async () => {
    const { canvas } = recordingCanvas();
    const plan = buildExportPlan(input());
    const blob = await renderExport(plan, bitmaps(), TOKENS, () => canvas);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("image/png");
  });

  test("draw-image sequence is frame → stamp → sticker", async () => {
    const { canvas, calls } = recordingCanvas();
    const plan = buildExportPlan(input());
    await renderExport(plan, bitmaps(), TOKENS, () => canvas);

    const tags = drawImageArgs(calls).map((a) => (a as FakeBitmap).__bitmap);
    // Frame is 8 ring pieces (some edges tiled → many drawImage calls), then the stamp, then the
    // sticker. Reduce to first-appearance order.
    const order = tags.filter((t, i) => tags.indexOf(t) === i);
    expect(order).toEqual(["frame", "stamp", "sticker"]);
  });

  test("taint canary: every drawImage first-arg is a decoded bitmap, never a URL or <img>", async () => {
    const { canvas, calls } = recordingCanvas();
    const plan = buildExportPlan(input());
    await renderExport(plan, bitmaps(), TOKENS, () => canvas);

    const args = drawImageArgs(calls);
    expect(args.length).toBeGreaterThan(0); // guards against a vacuous canary
    for (const arg of args) {
      // It is one of our tagged fake bitmaps — an object with __bitmap — not a string/URL/element.
      expect(typeof arg).toBe("object");
      expect(arg).toHaveProperty("__bitmap");
      expect(typeof (arg as FakeBitmap).__bitmap).toBe("string");
    }
  });

  test("no today disc: the renderer never strokes/fills a circle (arc is never called)", async () => {
    const { canvas, calls } = recordingCanvas();
    const plan = buildExportPlan(input());
    await renderExport(plan, bitmaps(), TOKENS, () => canvas);
    expect(calls.some((c) => c.method === "arc" || c.method === "ellipse")).toBe(false);
  });

  test("a missing bitmap (skipped image) is not drawn and does not throw", async () => {
    const { canvas, calls } = recordingCanvas();
    const plan = buildExportPlan(input());
    // No stamp bitmap available (offline + not on device).
    const blob = await renderExport(
      plan,
      bitmaps({ stamps: new Map() }),
      TOKENS,
      () => canvas,
    );
    expect(blob).toBeInstanceOf(Blob);
    const tags = drawImageArgs(calls).map((a) => (a as FakeBitmap).__bitmap);
    expect(tags).not.toContain("stamp");
    expect(tags).toContain("sticker");
  });

  test("frame 'none': no frame bitmap is drawn, grid still renders", async () => {
    const { canvas, calls } = recordingCanvas();
    const plan = buildExportPlan(input({ frame: "none" }));
    await renderExport(plan, bitmaps({ frame: null }), TOKENS, () => canvas);
    const tags = drawImageArgs(calls).map((a) => (a as FakeBitmap).__bitmap);
    expect(tags).not.toContain("frame");
    // A cell fill still happened.
    expect(calls.some((c) => c.method === "fillRect")).toBe(true);
  });
});
