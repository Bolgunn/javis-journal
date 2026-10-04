/**
 * M11 decision 8 — "Guest · saved on this device only". Always shown to a guest, never to Javi:
 * it reassures a visitor that their photos go nowhere, and tells the owner at a glance which
 * world a preview is in.
 *
 * It must not touch the fit model, so it is `fixed` and out of flow — no measured box (the title
 * wrapper's `titleH`, `FramedGrid`) grows, so neither `cellW` nor the export can move. It sits
 * bottom-centre, where the preview-lock note sits (the two never show together: a guest is never
 * locked): above the title it was clipped whenever the layout is height-bound (a phone's
 * close-up), because the title then shares the top bar's row. It takes no taps, and the day page
 * and sheets cover it.
 */
export function GuestPill() {
  return (
    <p
      className="pointer-events-none fixed inset-x-0 bottom-3 z-[5] mx-auto w-fit whitespace-nowrap rounded-full border border-line bg-paper/90 px-3 py-1 text-xs font-semibold text-muted shadow-sm"
      role="status"
    >
      Guest · saved on this device only
    </p>
  );
}
