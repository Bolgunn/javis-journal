import { expect, test } from "vitest";

import { isHeic } from "./heic";

function ascii(s: string): number[] {
  return [s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)];
}

// Build a minimal ISOBMFF ftyp box: [size][ftyp][major][minor][compatible...].
function ftyp(major: string, compatible: string[] = []): Uint8Array {
  const size = 16 + compatible.length * 4;
  const b = new Uint8Array(size);
  b[0] = (size >>> 24) & 0xff;
  b[1] = (size >>> 16) & 0xff;
  b[2] = (size >>> 8) & 0xff;
  b[3] = size & 0xff;
  b.set(ascii("ftyp"), 4);
  b.set(ascii(major), 8);
  // bytes 12..16 = minor_version (0)
  compatible.forEach((brand, i) => b.set(ascii(brand), 16 + i * 4));
  return b;
}

test("detects the heic major brand", () => {
  expect(isHeic(ftyp("heic"))).toBe(true);
});

test("detects the heix major brand", () => {
  expect(isHeic(ftyp("heix"))).toBe(true);
});

test("detects the mif1 major brand", () => {
  expect(isHeic(ftyp("mif1"))).toBe(true);
});

test("detects heic listed among compatible brands", () => {
  expect(isHeic(ftyp("mp42", ["isom", "heic"]))).toBe(true);
});

test("rejects a JPEG magic header", () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);
  expect(isHeic(jpeg)).toBe(false);
});

test("rejects a PNG magic header", () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d]);
  expect(isHeic(png)).toBe(false);
});

test("rejects a non-HEIF ftyp box (mp42/isom/avc1)", () => {
  expect(isHeic(ftyp("mp42", ["isom", "avc1"]))).toBe(false);
});

test("accepts an ArrayBuffer as well as a Uint8Array", () => {
  const bytes = ftyp("heic");
  expect(isHeic(bytes.buffer as ArrayBuffer)).toBe(true);
});

test("rejects a too-short buffer", () => {
  expect(isHeic(new Uint8Array([0x00, 0x01, 0x02]))).toBe(false);
});
