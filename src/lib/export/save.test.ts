import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { canShareFiles, downloadBlob, exportFilename, shareBlob } from "./save";

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

beforeEach(() => {
  // Node 20 has a global File; ensure it exists for the share/probe paths.
  if (typeof File === "undefined") {
    vi.stubGlobal("File", class {});
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("filename is javis-journal-YYYY-MM.png with a zero-padded month", () => {
  expect(exportFilename(2026, 7)).toBe("javis-journal-2026-07.png");
  expect(exportFilename(2026, 12)).toBe("javis-journal-2026-12.png");
});

// ---- canShareFiles (the Share-button gate) ----

test("canShareFiles is true when share + canShare({files}) are supported", () => {
  vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => true });
  expect(canShareFiles()).toBe(true);
});

test("canShareFiles is false when canShare reports files aren't shareable", () => {
  vi.stubGlobal("navigator", { share: vi.fn(), canShare: () => false });
  expect(canShareFiles()).toBe(false);
});

test("canShareFiles is false when there is no share API at all (desktop)", () => {
  vi.stubGlobal("navigator", {});
  expect(canShareFiles()).toBe(false);
});

// ---- shareBlob ----

test("shareBlob resolves 'shared' when the share sheet completes", async () => {
  const share = vi.fn<(data: ShareData) => Promise<void>>(async () => undefined);
  vi.stubGlobal("navigator", { share, canShare: () => true });

  await expect(shareBlob(PNG, "m.png")).resolves.toBe("shared");
  const arg = share.mock.calls[0][0] as { files: File[]; title: string };
  expect(arg.files).toHaveLength(1);
  expect(arg.title).toBe("m.png");
});

test("shareBlob resolves 'dismissed' on an AbortError (she backed out)", async () => {
  const share = vi.fn(async () => {
    throw Object.assign(new Error("dismissed"), { name: "AbortError" });
  });
  vi.stubGlobal("navigator", { share, canShare: () => true });

  await expect(shareBlob(PNG, "m.png")).resolves.toBe("dismissed");
});

test("shareBlob rejects on a non-Abort error — no silent download fallback", async () => {
  const share = vi.fn(async () => {
    throw Object.assign(new Error("boom"), { name: "NotAllowedError" });
  });
  vi.stubGlobal("navigator", { share, canShare: () => true });
  const anchor = stubDocument();

  await expect(shareBlob(PNG, "m.png")).rejects.toThrow("boom");
  expect(anchor.click).not.toHaveBeenCalled(); // never crosses over to a download
});

test("shareBlob rejects when the share API is absent", async () => {
  vi.stubGlobal("navigator", {});
  await expect(shareBlob(PNG, "m.png")).rejects.toThrow();
});

// ---- downloadBlob ----

test("downloadBlob triggers a direct <a download>, never the share sheet", () => {
  const share = vi.fn();
  vi.stubGlobal("navigator", { share, canShare: () => true });
  const anchor = stubDocument();

  downloadBlob(PNG, "javis-journal-2026-07.png");

  expect(anchor.click).toHaveBeenCalledOnce();
  expect(anchor.download).toBe("javis-journal-2026-07.png");
  expect(share).not.toHaveBeenCalled();
});
