import { afterEach, expect, test, vi } from "vitest";

import { downloadBlob, exportFilename } from "./save";

const PNG = new Blob(["png"], { type: "image/png" });

type AnchorStub = { href: string; download: string; click: () => void; remove: () => void };

function stubDocument() {
  const anchor: AnchorStub = {
    href: "",
    download: "",
    click: vi.fn(),
    remove: vi.fn(),
  };
  vi.stubGlobal("document", {
    createElement: vi.fn(() => anchor),
    body: { appendChild: vi.fn() },
  });
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn(() => "blob:mock"),
    revokeObjectURL: vi.fn(),
  });
  return anchor;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("filename is javis-journal-YYYY-MM.png with a zero-padded month", () => {
  expect(exportFilename(2026, 7)).toBe("javis-journal-2026-07.png");
  expect(exportFilename(2026, 12)).toBe("javis-journal-2026-12.png");
});

test("the two carousel halves are -1 (left) and -2 (right)", () => {
  expect(exportFilename(2026, 7, 1)).toBe("javis-journal-2026-07-1.png");
  expect(exportFilename(2026, 7, 2)).toBe("javis-journal-2026-07-2.png");
});

// ---- downloadBlob ----

test("downloadBlob triggers a direct <a download>", () => {
  const anchor = stubDocument();

  downloadBlob(PNG, "javis-journal-2026-07.png");

  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.download).toBe("javis-journal-2026-07.png");
});
