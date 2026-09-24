// M9-INSTAGRAM-PLAN decision 9 — PR previews cannot write stamps or stickers (kept permanently).
//
// The PR preview is the Tier-2 device rig AND it runs against the production Supabase project.
// Every stamp/sticker write pushes the WHOLE row — its `scale` included — so a preview built on a
// different coordinate space than production (the 7:6 → 8:5 change was the first) would save
// values in the wrong space into her real journal. Refusing those writes on previews removes the
// whole class of accident; reads, exports, profile settings and the seeded-sticker upsert are
// untouched.
//
// `NEXT_PUBLIC_VERCEL_ENV` is Vercel's system env var, inlined at build time. It is absent in
// local dev and tests (so nothing is locked there) unless a test stubs it.

/** True on a Vercel preview deployment: stamp and sticker writes are refused. */
export function editingLocked(): boolean {
  return process.env.NEXT_PUBLIC_VERCEL_ENV === "preview";
}

/** The note the UI shows while {@link editingLocked} — and the error a refused cut reports. */
export const EDITING_LOCKED_NOTE = "Preview — editing is off";
