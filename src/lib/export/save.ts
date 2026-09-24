// M9 — hand the finished PNGs to her. Since the Instagram addendum (M9-INSTAGRAM-PLAN decision 7)
// there is ONE mechanism, a direct `<a download>`: the sheet's two buttons ("Full image" and
// "2 halves") both end here. The native share sheet was removed — its only job was "Save to
// Photos", and a two-photo carousel wants the two files, not a share target.
//
// Touches `document`; no React, no Dexie, no canvas.

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * `javis-journal-2026-07.png` for the viewed month's full post; with `part`, one carousel half —
 * `javis-journal-2026-07-1.png` (left) or `…-2.png` (right), so they sort in posting order.
 */
export function exportFilename(year: number, month: number, part?: 1 | 2): string {
  const suffix = part ? `-${part}` : "";
  return `javis-journal-${year}-${pad2(month)}${suffix}.png`;
}

/** Direct download via a synthetic anchor. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
