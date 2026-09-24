# M9 addendum — the Instagram two-photo post (US-12)

> A post-M9 increment, not a milestone. Resolved in a `/grill-me` session on 2026-09-21…24.
> Tracking issue: #8. Javi chose the direction herself (option B below) from a mockup page.

## The ask

Javi posts each month to Instagram as a **two-photo carousel that joins into one wide image when
swiped**. Instagram crops every carousel slide to the first slide's ratio, and its tallest allowed
ratio is 4:5 — so the pair is **2 × 1080×1350 = one 2160×1350 composition (8:5)**. M9's PNG is
≈1.2:1 (7:6 cells), so it cannot be made to fit by resizing: the month has to be *laid out* at 8:5
and then cut down the middle.

(She first asked for "600×400". That is 3:2, which is neither 4:5 per slide nor 8:5 per pair; the
number was a guess at "wide". The target is Instagram's, not a taste call.)

## Decisions

### 1. The cells become 8:5 — app-wide, not export-only

`CELL_ASPECT_RATIO` in `src/lib/calendar/fit.ts` goes **7/6 → 8/5** (and `CELL_ASPECT` →
`"8 / 5"`). Everything else follows because it was already derived from it:
`PAGE_ASPECT = CELL_ASPECT_RATIO` (the day page) and `GRID_ASPECT = CELL_ASPECT_RATIO²` (the
sticker box, **49/36 → 64/25**).

The screen and the PNG stay the same geometry — the M5→M9 principle ("the PNG cannot drift from
the screen") survives.

Why 8:5 and not the per-frame "exact fill": the ratio that fills 2160×1350 exactly depends on the
frame's ink (Ruby 1.63, Clouds 1.60, Leaves 1.57, none 1.59). One fixed app ratio can't match
all four; 8:5 is the round number in the middle, and the export absorbs the leftover (decision 5).

Rejected:
- **Export-only wide cells** (the app stays 7:6; the PNG re-lays each day into a wider cell) —
  cheaper and touches no data, but the PNG stops matching the screen. Javi preferred B after
  seeing both.
- **A frame around the whole post / a title panel on the left / a coloured mat** — all keep 7:6
  but either move the month title off-centre (the owner ruled that out) or leave ~300px of dead
  paper per side.
- **Stretch everything** — squashes her photos.

**Cost, accepted knowingly** (iPhone 393×852): the day page drops to ~73% of its height
(345×216 vs 345×296); the full-month cell goes ~49×42 → ~49×31.

### 2. Close-up: `CLOSEUP_DIVISOR` 2.5 → 1.8

At 8:5 with 2.5 columns the close-up is width-bound (cells ~138×86) and stops two-thirds down the
screen with ~190px of dead space. At **1.8** it is height-bound again: cells ~192×120, ~1.8 days
across, no dead space. Below ~1.8 the cells stop growing (height binds); above it dead space
returns. Rejected: keep 2.5 (looks broken), keep 2.5 centred (the calendar floats).

### 3. Three fraction-of-width constants are re-tuned by 35/48

Width grew 37% relative to height (`(8/5)/(7/6) = 48/35`). Constants that are a fraction of
**width** keep their number and silently change their meaning, so the three that encode a
visual size are multiplied by **35/48 ≈ 0.729**:

| Constant | Old | New | Why |
|---|---|---|---|
| `PLACEMENT.MIN_SCALE` (`lib/day/place.ts`) | 0.12 | 0.0875 | same smallest pinchable stamp |
| `CHIP_FONT_RATIO` (`DayCell.tsx`) | 0.1 | 0.073 | day number keeps its size vs the cell's height |
| `EXPORT.DAY_FONT_RATIO` (`lib/export/plan.ts`) | 0.1 | 0.073 | must match `DayCell` |

Left alone (already in units that move with the shape): `PLACEMENT.MARGIN` (fraction of the
shorter side), `CASCADE`, `SECOND_SCALE` (match how migrated days look), `STICKER.DEFAULT_SCALE`
(1/7 = one cell wide, derived from the columns), `STICKER.MIN_SCALE`/`MAX_SCALE` (same pixel
widths → the 256px-thumb sharpness guardrail holds).

### 4. Existing stamps and stickers: `scale × 35/48`, positions untouched

Stamps store `pos_x/pos_y` (0..1 of the page) and `scale` (fraction of page **width**); stickers
the same on the grid box. Multiplying `scale` by 35/48 and leaving positions alone keeps every
stamp its size relative to the page and its spot within the day, and keeps every sticker **over
the same day** at the same spot (its `pos_x` is a grid fraction and the columns widen uniformly).
Cost: stamps she overlapped deliberately drift apart by up to 37% sideways.

Rejected: **change nothing** (stamps grow 37% vs the page height and overhang top/bottom, then
jump when the clamp next runs); **exact copy centred** (pixel-identical, but every pre-change day
wears paper strips at its sides forever — a visible seam in her history).

### 5. Export geometry turns inside out: the post size is the input

Today `EXPORT.CELL_W = 252` decides the PNG's size. From now on:

- `EXPORT.POST = { W: 2160, H: 1350 }` is the input; `SLICE_W = 1080`.
- The title band (when on), outer margin, weekday header and the ring's top/bottom ink are
  subtracted from the height; `cellW = min(heightBound, widthBound)` at 8:5.
- **The ring hugs the grid** (as on screen) and spans the full post width: its left/right edges
  are drawn wider by exactly the leftover `(W − 2·margin − 7·cellW) / 2`, with
  `border-image-width` scaled to match (the owner's choice: stretch the side pixels). At 8:5 the
  leftover is small (≈0–40px/side depending on frame), so the stretch is barely visible.
  `nineSliceRects` gains a per-side destination width; the CSS path is unchanged (on screen the
  ring is never stretched).
- **Frame `'none'`:** no ring, the leftover is plain paper.
- **The title toggle stays.** Off → more height → larger cells (width-bound if needed).
- `frameScale(gridW)` still lands on ×4.
- One 2160×1350 canvas is rendered; each half is `drawImage`d into its own 1080×1350 canvas.

### 6. The cut goes through the middle of the 4th column — accepted

The grid is centred, so x=1080 bisects column 4 (Thu for a Monday start, Wed for Sunday). This is
how every two-photo panorama works: swiped, the halves join and the stamp is whole. Rejected:
shift the grid half a cell (off-centre by ~145px, the title sits over the cut); a gap at the cut
(the photos no longer join — the whole point of the format).

### 7. Delivery: two buttons, both plain downloads

`ExportSheet` becomes: **title toggle · Full image · 2 halves**. Both buttons use today's
`downloadBlob` (`src/lib/export/save.ts`); **the Share button is removed** (`shareBlob` /
`canShareFiles` become dead — delete them with their tests).

- **Full image** → `javis-journal-2026-07.png` (2160×1350).
- **2 halves** → `javis-journal-2026-07-1.png`, `…-2.png` (1080×1350 each), left first.

⚠ iPhone Safari may block the second download from one tap (a Tier-2 check). If it does, the
fallback stays within the same mechanism: after the first half lands, the button becomes
"Download 2nd half" so each file gets its own tap. **Don't build the fallback unless the check
fails.**

### 8. Data migration: one SQL rewrite, no Dexie migration

A single Supabase migration rewrites every row — **including tombstoned ones** (an Undo restores
a soft-deleted stamp; it must come back in the new space):

```sql
-- One-shot data rewrite for the 7:6 → 8:5 cell change (M9-INSTAGRAM-PLAN decision 8).
-- Guarded so a manual re-run in the SQL editor is a no-op (the CLI's own tracker already
-- prevents a second `db push`; this protects against copy-paste).
create table if not exists public.data_migrations (
  name       text primary key,
  applied_at timestamptz not null default now()
);
alter table public.data_migrations enable row level security; -- no policies: invisible to clients

do $$
begin
  if exists (select 1 from public.data_migrations where name = 'cells_8x5') then
    raise notice 'cells_8x5 already applied — skipping';
    return;
  end if;
  update public.stamps          set scale = scale * 35.0 / 48.0, updated_at = now();
  update public.placed_stickers set scale = scale * 35.0 / 48.0, updated_at = now();
  insert into public.data_migrations (name) values ('cells_8x5');
end $$;
```

**`updated_at = now()` is the load-bearing line.** The delta pull (ALG-4, `lib/sync/pull.ts`)
filters `updated_at > cursor`; without the bump no device ever pulls the rewritten rows. With it,
every device's LWW merge replaces its local copy through the normal path.

**Why no Dexie v6 rewrite:** a device still on the old build would pull the already-migrated
rows, then the new build's upgrade would multiply them again (0.53×) and push that up. Leaving it
to sync means a lagging device shows stamps 27% small for a few minutes and is corrected by the
new build — nothing is ever multiplied twice. **No Dexie version bump at all** (no index
changes).

Rejected: a per-row `coord_space` tag converted at read time or backfilled client-side — the
safest for the data, but it either puts two coordinate spaces in every layout seam permanently or
costs an expand/backfill/contract cycle. The rollout runbook below buys the safety back.

### 9. Preview builds cannot write stamps or stickers (kept permanently)

The PR preview is the Tier-2 rig **and it runs against production**. An 8:5 preview editing an
un-migrated stamp would save an 8:5-space value, which the migration then shrinks again. So in
`src/lib/db/mutations.ts`, when `process.env.NEXT_PUBLIC_VERCEL_ENV === "preview"`, the stamp and
sticker writes (`createStampOnDay`, `updateStamp`, `deleteStamp`, `restoreStamp` and the sticker
equivalents) refuse, and the UI shows a small "Preview — editing is off" note. Reads, exports,
profile settings (frame, week start) and the seeded-sticker upsert are unaffected.

Check first: `NEXT_PUBLIC_VERCEL_ENV` is only present if the Vercel project exposes system env
vars (the default for Next.js projects) — verify on the preview before relying on it.

Expected on the preview (not a bug): every stamp looks ~37% too big, because the data is not
migrated until after merge.

## Rollout runbook (deliberate deviation from "push before merging")

The PR template says run `supabase db push` before merging. **Not this time** — the rewrite must
land *after* the new build is live, or the old build renders every stamp 27% small with nothing
to fix it.

1. ✅ **Backup** — `supabase db dump --data-only -f backup-pre-8x5.sql -s public` (done
   2026-09-24). Keep it **outside the repo**: the repo is public and the dump is her content.
2. **Tier-2 on the PR preview** (her phone): both buttons, the halves join when swiped, the
   second download isn't blocked, the close-up fills the screen, the guard blocks edits.
3. **Empty her outbox:** she opens the app on the network and leaves it a moment. An offline
   edit pushed after the rewrite would win LWW with old-space coordinates.
4. She **doesn't open the app** for the next few minutes. Nor does anyone edit stamps or stickers
   from a **signed-in local `pnpm dev`** of this branch before step 6: local dev also runs against
   production, and the preview guard (decision 9) only covers Vercel previews.
5. **Merge** (rebase) and wait for Vercel's production deploy to finish.
6. **`supabase db push`** — applies the rewrite.
7. **Verify** on your phone: open a month you know; stamps sit where she put them, stickers on
   their days. Download both images and check them.
8. If anything is wrong: restore `stamps.scale` / `placed_stickers.scale` from the backup
   (bump `updated_at` again so devices pull the fix).

## As built (deviations from the decisions above)

Built on `feat/instagram-post`, one commit per task. Where the build had to depart from the text:

- **The sticker grid box is 28/15, not 64/25** (decision 1). The grid is 7 columns × 6 rows of
  cells, so its aspect is `(7/6)·r`; it equalled `r²` = 49/36 at 7:6 only because the cell ratio
  happened to be 7/6 too. `GRID_ASPECT = (7/6) · CELL_ASPECT_RATIO`. Decision 4's sticker rewrite
  is unaffected (the grid still widens 48/35 for the same height).
- **M8's "the frame is free on a phone" now holds only in full-month** (decision 2). At 1.8 the
  phone close-up is height-bound, so the top ring edge — the one edge that is always charged —
  costs it `fh/6 · 8/5` ≈ 2px of cell width. `fit.test.ts` asserts both halves of that.
- **The ring's side stretch is sized on the ink** (decision 5). The side 9-slice column is `slice`
  px wide of which only the outer `ink` px are the ring, so widening the column by the leftover
  would also widen the paper mat. `stretchedSideW = slice · (scale + leftover/ink)` makes the ink
  band grow by exactly the leftover and keeps the mat screen-width. Measured leftovers are
  0–12.5px per side (Ruby with a title is the widest).
- **Vertical leftover** (title off, or a width-bound frame) centres the title + framed box on the
  post rather than growing the bottom margin.
- **The halves are copied from the post canvas**, so the taint canary now asserts two things: the
  post canvas only ever draws `ImageBitmap`s, and each half draws only the post canvas, once.
- **The migration's `updated_at` bump is `greatest(now(), max(updated_at) + 1ms)`** (decision 8).
  The pull cursor is the max *client-authored* `updated_at`, so a device whose clock ran ahead
  could hold a cursor past the server's `now()` and never pull the rewrite.
- **The preview guard** (decision 9): `createStampOnDay` throws a `DayWriteError` (the Stamper
  already shows those); the other seven writes no-op / return null, which every caller already
  treats as "nothing written". The image a refused cut ingested is still uploaded (harmless: the
  images table has no coordinate space).
- **The decision-7 fallback was needed.** On Javi's iPhone only the second of the two halves
  downloaded (Safari keeps the last download fired from one tap). "2 halves" now downloads the
  left half, holds the right one, and becomes "Download 2nd half" for its own tap — no second
  compose. Changing the title toggle or taking the full image drops the held half.
- **Stamp thumbs are drawn slightly larger than 1:1 in the PNG**: cells are ~289px wide now (were
  252), from the same 256px thumbs.

## Task DAG

```
T1 constants ──┬── T2 export geometry ── T3 export sheet + save
               ├── T4 close-up divisor
               └── T5 preview guard
T6 migration SQL (independent)
T7 docs (after T1–T6)
```

- **T1 — `feat: 8:5 day cells`**: `CELL_ASPECT_RATIO`/`CELL_ASPECT`, the three re-tuned
  constants, fix every test that hard-codes 7/6, 49/36, 252 or 216.
- **T2 — `feat(export): lay the month out on a 2160×1350 post`**: `EXPORT.POST`, derived
  `cellW`, per-side stretched ring in `nineSliceRects` + `plan.ts`, split render into two slices
  (`render.ts`), `composeMonthPng` returns `{ full, halves: [a, b] }`.
- **T3 — `feat(export): Full image + 2 halves buttons`**: `ExportSheet`, filenames
  (`exportFilename(year, month, part?)`), remove `shareBlob`/`canShareFiles`, update
  `/dev/export`.
- **T4 — `feat(calendar): close-up fills the height at 8:5`**: `CLOSEUP_DIVISOR = 1.8`.
- **T5 — `feat(db): previews cannot write stamps or stickers`**.
- **T6 — `feat(db): rewrite stamp and sticker scale for 8:5`**: the migration above. Must pass
  the CI `migrations` job (`supabase db reset` from zero — the guard must work on an empty DB).
- **T7 — `docs:`** AGENTS.md (every 7:6 / 49/36 mention, the Status entry), PLAN.md US-12.

T1–T5 can't really run in parallel (they all lean on the constant); build in one thread, commit
per task. T6 is genuinely independent.

## Definition of done

- `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` green; CI `check` + `migrations` green.
- Export tests assert: the full image is exactly 2160×1350; each half is exactly 1080×1350; the
  halves' pixels equal the full image's left/right halves; the ring's side edges widen by exactly
  the leftover; `'none'` draws no ring; stamp/sticker rects still equal `stampBoxes`/
  `stickerBoxes` (offset into the grid); still no "today" op; `drawImage` still only gets
  `ImageBitmap`s (the taint canary).
- Fit tests assert the close-up is height-bound on a 393×852 phone at divisor 1.8.
- A mutations test asserts every stamp/sticker write refuses under
  `NEXT_PUBLIC_VERCEL_ENV=preview`, and profile writes don't.
- The object-URL canaries (day page, sticker layer) still pass untouched.
- Tier-2 (runbook step 2) passed on Javi's phone.
- Runbook steps 3–7 done and verified in production.
- `closes #8`.
