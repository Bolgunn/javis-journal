<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Javi's Journal — project guide

A personal, phone-first, fully-responsive scrapbook-journal web app — a birthday gift for
Javi. Local-first canvas journaling: each calendar day is a decorable page where photos are
placed as resizable **stamps** (cut behind a shape mask) alongside custom **stickers**, on a
customizable **calendar** with a full-month progress view.

North star: **"the journal that never fights her."** Priorities: a superb stamp cutter, a
silent instant save/sync, and no long-run freeze — polish over feature count.

> The full planning docs live in `Wiki Javi's Journal/`: IDEA, PLAN (user stories US-1…US-14
> + milestone DAG), SCHEMA (Postgres/Supabase), and DESIGN (interactions, API surface,
> algorithms ALG-1…ALG-9). Read those before implementing a story.

## Status
Milestone roadmap and DAG live in `Wiki Javi's Journal/PLAN.md`; each milestone's resolved
execution plan lands in `Wiki Javi's Journal/plans/M{N}-PLAN.md` (see Methodology below).

- [x] **M1 — Foundation + auth** (US-1) — schema, RLS, private storage bucket, Supabase
      clients, allowlist gate, session proxy, login/denied pages, health cron all done and
      committed. **One manual step left:** repairing the Google OAuth redirect URI in the
      Google/Supabase console.
- [x] **M2 — Local-first + sync** (US-11, sync half of US-13) — Dexie schema (6 entity
      tables + `sync_outbox`/`sync_meta`), debounced push (ALG-3) with poison-pill
      quarantine, delta-pull LWW-merge (ALG-4) with tombstones, exponential backoff, and
      `SyncBoot` wired live into the root layout. Verified by 8 vitest + fake-indexeddb
      integration tests. Built via `/parallel-plan` (M2-PLAN.md); resolved plan in
      `Wiki Javi's Journal/plans/M2-PLAN.md`.
- [x] **M3 — Image pipeline (compression half of US-13)** — headless image layer:
      ALG-1 `processImage` (EXIF-baked decode, ~40MP decode cap, stepped-halving downscale,
      JPEG q0.8 / PNG) in a Web Worker with main-thread fallback; **HEIC transcode
      (`heic2any`) runs on the main thread** (it needs the DOM, throws in a worker); new
      `image_blobs` Dexie v2 store (original + main + thumb, sync-invisible) with 72h
      original eviction behind an upload-durability interlock; the deferred `images` upload
      path wired into `flush()` (runs before the LWW tables); a local-first thumb display
      helper (signed-URL fallback + lazy backfill, LRU-capped object URLs). Verified by 52
      vitest tests + a Tier-2 owner gate on a real Pixel 9 (upload → durable, HEIC upright).
      Built directly on `ui-design` (the `/parallel-plan` worktree agents failed again — see
      `.claude/dag-state.json`). Dev harness at `/dev/image-pipeline`.
- [x] **M4 — Calendar views** (US-2, US-3, US-4, US-5) — the real data-backed calendar home:
      a single client island at `/` (view + current month are React state, never the URL) with
      a **`MonthCloseUp`** (column-major free-scroll, opens centered on today, US-2 clamp) and a
      **`MonthFull`** (7×6 fit-to-viewport) sharing one fit model + `DayCell`; **pinch-to-switch**
      (touch) + a 3-dots "Toggle full-month view" (all devices); a **read seam**
      `src/lib/db/queries.ts` (`dexie-react-hooks`; components never call `db.*`) with a batched
      one-`getThumbUrls`-per-month load and **release-on-unmount** object-URL discipline (ALG-6,
      single mounted month — the ±1-carousel wording is superseded); ALG-5 `monthGrid` +
      week-start Mon/Sun (persisted via `markDirty`); a `[2026-07, current]`-bounded month picker;
      logout. New Dexie **v3** `entries.entry_date` index (⚠ renumber vs M5 at merge). **Dropped
      the Today button** (documented deviation on US-3). Verified by 79 vitest tests incl. an
      object-URL canary; dev harness at `/dev/calendar`. Tier-2 (real-device) is an owner gate.
      Built directly on `m4-calendar` off `ui-design` (no `/parallel-plan`).
- [x] **M5 — Stamper / cutter** (US-6) — the destructive WebP-alpha bake (ADR-M5): a single
      render path shared by preview and bake, 4 masks, the rotation-aware no-blank-corner clamp,
      ingest through the M3 image layer. M6 re-skinned its UI (see below).
- [x] **M6 — Day editor + punch machine** (US-7, US-8) — the first writer of `entries`/`stamps`.
      The **day page** is a client overlay inside the Calendar island — the calendar cell
      zoomed (`CELL_ASPECT` reused; 7:6 then, 8:5 since the Instagram addendum), FLIP-animated
      out of the tapped cell, with a `history` back-guard. Editing is **direct manipulation** (ADR-M6 — DESIGN's long-press *menu* is
      dropped): long-press selects (blue glow), then drag / pinch / twist (45° snap on release,
      **one write per gesture, on gesture-end**); a short tap on any stamp toggles front/back; a
      floating ✕ soft-deletes with an Undo toast that restores the original `layer_order`.
      Placement is ALG-8 with every tunable in one `PLACEMENT` object; hit-testing is our own
      math (inverse-rotate → bbox → top `layer_order`), because a baked heart's transparent
      corner would let the DOM steal a tap. The **calendar cell now renders the day's real
      composition** through the same `stampBoxes()`. M5's placeholder card became the
      **skeuomorphic punch machine** (`public/stamper/punch.webp`, 50KB — the preview canvas sits
      *behind* the art's transparent hole; the drawer plate is the press-to-cut surface); its
      rotate-*mode* toggle and −/+ steppers are retired for two-finger pinch/twist. Schema:
      `stamps.crop_*` dropped (**owner must run `supabase db push`**), Dexie **v4**. Verified by
      158 vitest tests incl. the day-page object-URL canary and the pinch-isolation test; dev
      harness at `/dev/day`. Tier-2 (real-device) is an owner gate.
- [x] **M7 — Stickers + tray (US-9)** — the calendar becomes *hers*. **Headline reversal
      (ADR-M7, `plans/M7-PLAN.md`): stickers are MONTH-BOUNDED, not a global layer** — a sticker
      placed on July 2026 lives on July 2026 (`placed_stickers.year_month`); the **tray stays
      global**. `StickerLayer` renders inside the **day-grid bbox** (`7·cellW × 6·cellH`, aspect
      derived as `(7/6)·CELL_ASPECT` — 49/36 then, **28/15** at 8:5 (that it equalled
      `CELL_ASPECT²` at 7:6 was a coincidence) — the one rect identical in both views, and the
      rect M9 exports), so a sticker keeps its place across a view switch and scrolls with the close-up
      grid for free. **Selection is what makes a manipulable layer safe on top of a scrolling,
      pinchable calendar** (the four isolation cases): unselected, the layer is
      `pointer-events: none` and a tap on a sticker is handed *back* to the day underneath it
      (`dateAtGridPoint`); selected, it arms itself and Calendar's pinch no-ops off
      `stickerSelectedRef`. M6's `DayGestures` was **extracted** into a surface-parameterized
      `TransformGestures` (`src/lib/gestures/`: machine + hit + layers) that stamps and stickers
      now share — a mechanical refactor, proven by M6's 166 tests passing untouched — along with
      the desktop `TransformBar`. `sticker_assets` became a **normal LWW table** (it was pull-only
      and could never push); the 3 seeded stickers ingest through the M3 pipeline with
      **deterministic ids** so a second device upserts instead of duplicating. Schema: `year_month`
      + a seeded-delete trigger (**owner must run `supabase db push`**), Dexie **v5**. Verified by
      214 vitest tests incl. the sticker object-URL canary (50 months flat, one URL per *distinct
      asset*) and the four isolation cases; dev harness at `/dev/stickers`. Tier-2 (real-device,
      incl. the sticker-sharpness knob) is an owner gate.
- [x] **M8 — Pokémon frames (US-10)** — three pixel-faithful 9-slice `border-image` frames
      (`public/frames/*.png`, **220–300 bytes each**), extracted from Javi's reference
      screenshots by `scripts/extract-frames.mjs` and switchable from the 3-dots menu.
      **The frame rings the calendar, not the viewport** — `FramedGrid` wraps the weekday header
      + 7×6 grid (title outside), so the framed box is *the same rectangle* in full-month, in the
      close-up scroller (where the ring scrolls with the columns), and in **M9's exported PNG**,
      which is the whole point of the feature. All geometry lives in one measured constants
      object (`src/lib/frames/spec.ts`, M6's `PUNCH_WINDOW` lesson) beside `nine-slice.ts` —
      a pure, DOM-free `nineSliceRects()` that **M9's canvas export imports verbatim**, so the
      CSS and the canvas cannot drift. The ring is charged **per edge**: left/right/bottom
      overhang into the 24px `GUTTER` (free), the top edge is paid for (the title is above it) —
      so **`cellW` on a phone is bit-identical with and without a frame** (in full-month; since the
      8:5 addendum the phone close-up is height-bound and pays the top ring's ~2px).
      `border-image-outset` is **0**: the slice surplus (the fat corner) overhangs *inward* over the transparent mat,
      never outward off-screen (the plan had this backwards; caught by rendering it). **No Dexie
      bump** (the schema stays M7's v5): `profiles.selected_frame` already existed and already
      synced. Verified by 227 vitest tests (pre-merge); dev harness at `/dev/frames`. Tier-2
      (real-device) is an owner gate.
      **Addendum — `'none'`** (`plans/M8-FRAME-NONE.md`): she can wear no frame. Bare is reached by
      **re-tapping the swatch she already wears**, which takes the frame off — and that is the *only*
      way in: the plan's fourth dashed **None** swatch was built, then **removed** from the 3-dots
      menu (the frame row is the three real swatches, `FRAME_IDS.map`). One tap out, one tap back in,
      so nothing is trapped; the cost is that while bare, no swatch reads as selected and the state
      is legible only from the calendar itself. `'none'` is a fourth value in the column (CHECK widened — **owner must run
      `supabase db push`**), never a null and never a second boolean: the client reads
      `?? DEFAULT_FRAME`, where the `??` means *no profile row yet*, so a null would silently
      restore Ruby. The types split — **`FrameId`** (the three real frames, the keys of `FRAMES`)
      vs **`SelectedFrame = FrameId | "none"`** (what the DB holds) — so `FRAMES[frame]` without
      narrowing fails to compile and the compiler, not a reviewer, forces every consumer to handle
      the bare case. `FramedGrid` still **mounts** under `'none'` (it owns `data-month-frame`, M9's
      export target: an unframed month is the framed box wearing nothing, not the absence of the
      box). Layout is a no-op on a phone — under the per-edge rule only the top ink is paid for, so
      `cellW` is bit-identical. Still no Dexie bump (an unindexed value column's domain widening).
      281 vitest tests.
- [x] **M9 — PNG export (US-12)** — the **viewed** month (Calendar's `{year, month}` state, never
      `todayISO()`) composed to a PNG from the 3-dots **Download PNG** item. A pure export layer in
      `src/lib/export/`: `plan.ts` (DOM-free draw-op geometry that **reuses the existing seams** —
      `nineSliceRects`, `stampBoxes`, `stickerBoxes` — so the PNG cannot drift from the screen),
      `data.ts` (the Dexie read seam yielding **untainted** blobs), `render.ts` (the one file that
      touches a canvas; the taint-safety canary asserts `drawImage` only ever gets `ImageBitmap`s),
      `save.ts` (share-sheet vs download, `AbortError` swallowed — the share path was removed by the
      Instagram addendum) and the `exportMonthPng` orchestrator. Verified by **320 vitest tests** (the whole suite on `master` today; M8's 281 is
      that milestone's historical figure). UI: `ExportSheet.tsx` (title toggle + **Share**/**Save** — now **Full image**/**2 halves**).
      The export target is M8's `data-month-frame` box, so frame + stickers + thumbs come along and
      today's disc is deliberately **not** drawn. Merged via PR #2; dev harness at `/dev/export`.
      Tier-2 (real-device) is an owner gate.
- [ ] **M9 addendum — Instagram two-photo post (US-12)** — *built on `feat/instagram-post`, not
      merged; Tier-2 + the rollout runbook pending.* She posts each month as a 2-photo Instagram
      carousel (2 × 1080×1350 = one 2160×1350 image), so the day cells went **7:6 → 8:5 app-wide**
      (`CELL_ASPECT_RATIO`; the day page follows, and the sticker grid box is `(7/6)·r` = **28/15** —
      the plan's "64/25" was the 7:6 coincidence `r²`), the close-up divisor **2.5 → 1.8** (a phone
      close-up is height-bound again and fills the screen), and three fraction-of-width sizes were
      re-tuned × 35/48 (`PLACEMENT.MIN_SCALE`, `CHIP_FONT_RATIO`, `EXPORT.DAY_FONT_RATIO`). The export
      now takes the **post size as its input** (`EXPORT.POST`) and derives `cellW`; the ring spans the
      full post and its side edges stretch by exactly the leftover (0–12.5px/side — `nineSliceRects`
      gained per-side widths, sized so the *ink* grows and the mat stays screen-width); the grid is
      centred, so the cut at x=1080 bisects column 4. `renderExport` draws one post canvas and copies
      each half out of it. `ExportSheet`: title toggle + **Full image** + **2 halves** (plain
      downloads, `-1`/`-2` filenames; Share + `shareBlob`/`canShareFiles` deleted). Existing
      stamps/stickers are rewritten `scale × 35/48` by one guarded migration
      (`20260924000000_cells_8x5.sql`, `updated_at` bumped past every cursor) that is pushed
      **after** the deploy — no Dexie migration or bump, sync carries it. **Preview builds refuse
      every stamp/sticker write** (`src/lib/db/preview-guard.ts`, permanently), since a preview runs
      against production. 359 vitest tests. Plan + rollout runbook: `plans/M9-INSTAGRAM-PLAN.md`.
- [ ] M10 — Stability gate + polish + ship (US-13 hard gate, US-14). Built but **not merged**:
      5 commits on `m10-ship` (cut-sound module + Stamper snip + mute toggle, the long-run tour at
      `/dev/longrun`, the offline hint) sit in **draft PR #6**, rebased and green. Parked on
      purpose — more sound work comes first.

## Stack
- **Next.js (App Router) + React + TypeScript**, deployed on Vercel.
- **Supabase** — Auth (Google OAuth + email allowlist + `OWNER_OVERRIDE_EMAIL`), Postgres
  (RLS `auth.uid() = user_id`), Storage (private bucket + signed URLs).
- **Local-first**: IndexedDB via **Dexie** (entries, stamps, placed_stickers, images incl.
  uncompressed originals, sticker_assets, profiles, sync cursors).
- **Sync engine**: debounced push/pull to Supabase, **last-write-wins per element** via a
  client-authored `updated_at`; `deleted_at` tombstones propagate deletes.
- **Image pipeline**: client-side HEIC decode (`heic2any`), EXIF fix, downscale ~2048px
  (q0.8) + 256px thumbnail; only compressed + thumb upload, originals stay on-device.
- **Cutter**: canvas-based masking (`destination-in`), crop stored in normalized source-pixel
  space (never CSS `clip-path`, never a baked cutout).
- **Styling**: **Tailwind CSS v4** (CSS-first `@theme` token layer in `src/app/globals.css`;
  PostCSS plugin, no `tailwind.config.js`). Semantic design tokens (`--color-paper/ink/
  accent/today`, `--font-title/body`, `--radius-*`) drive utilities (`bg-paper`, `text-ink`,
  `font-title`, …). **Swappable `data-theme`** aesthetics: `pastel` ships (set on `<html>`);
  `paper` + `scrapbook` are dev-time comparison themes (override the same token vars). No OS
  dark mode — the chosen aesthetic is committed. CSS Modules may still be used for complex
  canvas/cutter styling where utilities fall short. Tune the look live at `/preview`
  (dev-only, fit-to-screen month calendar + theme switcher).

## Layout
- `src/app/` — routes (App Router). API routes: `api/auth/gate` (allowlist sign-in gate),
  `api/health` (cron warm-ping).
- `src/components/` — UI screens (calendar close-up, full-month, day page, stamper, sticker
  picker, 3-dots menu). `src/components/calendar/` — the M4 calendar island (`Calendar`,
  `MonthCloseUp`, `MonthFull`, `DayCell`, `MonthTitle`, `WeekdayHeader`, `TopBar`,
  `CalendarMenu`, `MonthPicker`).
- `src/lib/db/` — Dexie schema + local-first store. **Reads go through `queries.ts`**
  (`useMonthData`/`useDayView`/`useProfile`, the sole component read seam); **writes go through
  `mutations.ts`** (`createStampOnDay`/`updateStamp`/`deleteStamp`/`restoreStamp`/
  `setStartOfWeek`/`setSelectedFrame`, all via `markDirty`). Components never call `db.*`
  directly. `preview-guard.ts` (`editingLocked`) makes every stamp/sticker write refuse on a
  Vercel preview, which runs against production.
- `src/lib/frames/` — the M8 frame layer, pure: `spec.ts` (the single `FRAMES` constants object —
  each frame's measured `ink`/`slice` insets, the stepped ×2/×3/×4 `frameScale`, the `FRAME_MAT`),
  `nine-slice.ts` (`nineSliceRects` — **the seam M9's canvas export imports**, since CSS
  `border-image` does not apply to canvas), `style.ts` (`frameCss`). The ring itself is
  `src/components/calendar/FramedGrid.tsx` (`data-month-frame` — M9's export target).
- `src/lib/calendar/` — pure calendar geometry: `month-grid.ts` (ALG-5, today/bounds/date
  helpers), `fit.ts` (the shared 8:5 cell-fit model, `CELL_ASPECT`) + `pinch.ts` (the
  pinch-to-switch decision, incl. the M6 pinch-isolation rule). No React, no Dexie.
- `src/lib/gestures/` — the **shared** direct-manipulation layer (M7): `machine.ts`
  (`TransformGestures` + the `Surface` its caller injects — one state machine and one set of
  commit rules for both stamps and stickers), `hit.ts` (rotated-box hit-testing), `layers.ts`
  (front/back). `src/components/ui/TransformBar.tsx` — the shared desktop `− + ⟲ ⟳` bar.
- `src/lib/day/` — the day editor's pure layer: `place.ts` (ALG-8 + the single `PLACEMENT`
  constants object + every clamp), `layout.ts` (`stampBoxes` — the one composition function the
  day page, the calendar cell and the M9 export all share), `hit.ts`, `gestures.ts` (the day
  surface: the 8:5 page).
  No React, no Dexie. `src/components/day/` — `DayPage`, `DayStamp`, `UndoToast`, `AddStampFlow`.
- `src/lib/sticker/` — the sticker pure layer (M7): `place.ts` (the single `STICKER` constants
  object, the 28/15 grid box + its clamps, tap-placement + cascade + the 50-per-month cap),
  `layout.ts` (`stickerBoxes`), `cell.ts` (which day a point lands on — the tap-through rule),
  `gestures.ts` (the sticker surface), `seed.ts`/`seeds.ts` (the 3 seeded stickers, deterministic
  ids). `src/components/sticker/` — `StickerLayer`, `StickerTray`.
- `src/lib/sync/` — debounced sync engine (ALG-3/ALG-4, LWW + tombstones).
- `src/lib/image/` — image pipeline + stamp cutter (ALG-1/ALG-2). `thumb-url.ts` is the sole
  image-read seam (`getThumbUrls`, ALG-6 object-URL release).
- `src/lib/supabase/` — browser + server Supabase clients (`@supabase/ssr`).
- `src/lib/auth/` — allowlist gate helpers + owner-override.
- `src/proxy.ts` — session-refresh + login/home redirect proxy (this Next.js version
  renamed `middleware.ts` → `proxy.ts`; see the banner at the top of this file).
- `public/frames/` — Pokémon `border-image` frame assets. `public/stickers/` — seeded stickers.

## Environment
Copy `.env.local.example` → `.env.local` and fill in the Supabase project keys and
`OWNER_OVERRIDE_EMAIL`. Never commit `.env.local`.

## Commands
- **Package manager: pnpm** (pinned via `packageManager` in `package.json`). Don't
  reintroduce `package-lock.json`.
- `pnpm dev` — start the dev server (http://localhost:3000).
- `pnpm build` / `pnpm start` — production build / serve.
- `pnpm lint` — ESLint.
- `pnpm typecheck` — `next typegen && tsc --noEmit`. Covers the test files, which
  `next build` never typechecks.
- `pnpm test` — the vitest suite.

## Workflow
Resolved in `Wiki Javi's Journal/plans/WORKFLOW-PLAN.md`. **`master` is what is on Javi's
phone**, holding real data with **no backup**. Dev runs against that same production project.

- **Trunk-based.** Short-lived `feat/*` · `fix/*` · `chore/*` branches → PR → `master`. No
  `develop`. A ruleset on `master` rejects direct pushes (no bypass) and requires the `check`
  and `migrations` CI jobs plus Vercel's deployment check. 0 approvals (self-approval is
  impossible). Merge commits are disabled: **rebase-merge** multi-commit PRs (keeps
  commit-per-task), squash one-liners. Record PR numbers in plan docs, not branch SHAs.
- **The PR preview is the Tier-2 device rig** — open it on the phone before merging.
- **CI** (`.github/workflows/ci.yml`): `check` = lint + typecheck + test; `migrations` =
  `supabase db reset` from zero whenever `supabase/**` changed. Vercel owns `next build`.
- **Migrations are applied by hand** (`supabase db push`, before merging — the PR template
  checklist) and are **additive-first** (expand/contract): add in one PR, stop reading the old
  shape, drop it in a *later* PR, so code and schema work in either deploy order.
- **The allowlist is data, not schema.** The repo is public: never commit an email. Rows are
  managed in the Supabase SQL editor.
- **Issues are the inbox** (labels `bug` / `idea` only); designs still go to `plans/`. PRs
  say `closes #N`.
- **Dependencies:** Dependabot security updates only; `pnpm update` by hand at the start of a
  feature branch. Node is pinned in `.node-version` (= Vercel's 24.x).

## Methodology
Each milestone (M2…M10) is worked in two phases:

1. **Design** — run `/grill-me` against the milestone's slice of `PLAN.md` / `DESIGN.md`
   to resolve every open decision (data shapes, edge cases, ordering, naming) before any
   code is written. The output is `M{N}-PLAN.md`, saved to `Wiki Javi's Journal/plans/`,
   with a task DAG and a definition of done.
2. **Build** — execute the plan:
   - If the DAG has genuinely independent leaf tasks (e.g. a DB migration alongside
     application code), use `/parallel-plan` to run them concurrently as `codex:rescue`
     agents in isolated git worktrees.
   - Otherwise — a single thread of work, or tasks with real interdependencies — build
     directly in the main worktree; don't pay for agent isolation that isn't needed.
   - `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` must pass before a task
     counts as done (CI enforces all four on the PR).
   - Commit per task with a conventional `feat:`/`chore:`/`fix:` message, not one giant
     milestone commit.

M1 was built this way. Two of its three parallel-plan tasks lost git state mid-run and
needed manual recovery onto `master` (see `.claude/dag-state.json`) — a known failure mode
of the worktree/agent flow to watch for, not a reason to avoid parallelizing genuinely
independent work.

## Guardrails
- This is a personal gift locked to Javi's Google account — keep sign-up disabled behind the
  allowlist, with the owner-override recovery path.
- Never load full-res images in the month/day grid — thumbnails only; virtualize history and
  revoke object URLs (the fix for the ~20-day freeze). See DESIGN ALG-6.
- Keep the editor reliable above all; decorative flourishes (cut animation, fireworks) are
  last-mile and must degrade gracefully.
