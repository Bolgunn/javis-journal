"use client";

import { useEffect, useState } from "react";

import { FramedGrid } from "@/components/calendar/FramedGrid";
import type { SelectedFrame } from "@/lib/db/types";
import { FRAMES, FRAME_IDS, frameBoxInsets, frameScale } from "@/lib/frames/spec";
import { frameCss } from "@/lib/frames/style";
import { nineSliceRects } from "@/lib/frames/nine-slice";

/**
 * M8 Tier-2 harness (owner-run, on a real phone). Every frame at every scale, the geometry the
 * CSS is actually using, and a live framed mini-calendar — the question no unit test can answer
 * is whether a 12px pixel scallop *reads* at arm's length.
 */
export function FramesHarness() {
  const [viewportW, setViewportW] = useState(0);
  const [frame, setFrame] = useState<SelectedFrame>("hgss_15");

  useEffect(() => {
    const onResize = () => setViewportW(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const liveScale = viewportW > 0 ? frameScale(viewportW) : 2;

  return (
    <main className="min-h-svh bg-page p-6 text-ink">
      <h1 className="font-title text-2xl">M8 — Pokémon frames</h1>
      <p className="mt-1 text-sm text-muted">
        viewport {viewportW}px → live scale ×{liveScale}
      </p>

      {/* Every frame × every scale. On a phone the ×2 column is the one that ships. */}
      <div className="mt-6 space-y-8">
        {FRAME_IDS.map((id) => (
          <section key={id}>
            <h2 className="mb-2 font-title text-lg">
              {FRAMES[id].label}{" "}
              <span className="font-body text-xs text-muted">
                ({id} — framed box insets {frameBoxInsets(id, liveScale).w}×
                {frameBoxInsets(id, liveScale).h}px at ×{liveScale})
              </span>
            </h2>
            <div className="flex flex-wrap items-start gap-8">
              {[2, 3, 4].map((scale) => (
                <div key={scale}>
                  <div className="mb-1 text-xs text-muted">×{scale}</div>
                  <div
                    className="flex h-40 w-64 items-center justify-center bg-paper text-xs text-muted"
                    style={frameCss(id, scale)}
                  >
                    content edge
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* The M9 seam, rendered as numbers: what the canvas export will drawImage(). */}
      <section className="mt-10">
        <h2 className="mb-2 font-title text-lg">9-slice rects (the M9 export seam)</h2>
        <pre className="overflow-x-auto rounded-card border border-line bg-paper p-3 text-[11px] leading-tight">
          {frame === "none"
            ? "no frame — the export draws the grid and no ring"
            : nineSliceRects(FRAMES[frame], 390, 300, liveScale)
                .map(
                  (p) =>
                    `${p.key.padEnd(2)}  src ${fmt(p.src)}  dst ${fmt(p.dst)}  tiles ${p.tiles ?? "-"}`,
                )
                .join("\n")}
        </pre>
      </section>

      {/* A framed 7×6 grid at the live scale: does the ring bound the calendar cleanly? */}
      <section className="mt-10">
        <div className="mb-2 flex items-center gap-3">
          <h2 className="font-title text-lg">framed grid</h2>
          <select
            value={frame}
            onChange={(e) => setFrame(e.target.value as SelectedFrame)}
            className="rounded-control border border-line bg-paper px-2 py-1 text-sm"
          >
            {FRAME_IDS.map((id) => (
              <option key={id} value={id}>
                {FRAMES[id].label}
              </option>
            ))}
            <option value="none">None</option>
          </select>
        </div>
        {/* The real component the calendar and the M9 export both use — not a lookalike. */}
        <FramedGrid frame={frame} scale={liveScale} width={undefined}>
          <div className="grid grid-cols-7 gap-px bg-line">
            {Array.from({ length: 42 }, (_, i) => (
              <div
                key={i}
                className="aspect-[8/5] bg-paper p-1 text-[10px] text-muted"
              >
                {i + 1}
              </div>
            ))}
          </div>
        </FramedGrid>
      </section>
    </main>
  );
}

function fmt(r: { x: number; y: number; w: number; h: number }) {
  const n = (v: number) => String(v).padStart(4);
  return `${n(r.x)},${n(r.y)} ${n(r.w)}×${n(r.h)}`;
}
