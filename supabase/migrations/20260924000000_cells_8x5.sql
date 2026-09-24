-- One-shot data rewrite for the 7:6 → 8:5 cell change (M9-INSTAGRAM-PLAN decision 8).
--
-- Stamps store `scale` as a fraction of the day page's WIDTH, placed stickers as a fraction of
-- the day grid's width. At 8:5 both boxes are 48/35 wider for the same height, so `scale × 35/48`
-- keeps every stamp and sticker its size relative to the box's height; positions (0..1 of the
-- box) are left alone, so everything stays over the same spot of the same day.
--
-- Every row is rewritten, INCLUDING tombstoned ones: an Undo restores a soft-deleted stamp, and
-- it must come back in the new space.
--
-- ROLLOUT: apply with `supabase db push` only AFTER the 8:5 build is live in production — the old
-- build would render every rewritten stamp 27% small with nothing to correct it. See the rollout
-- runbook in M9-INSTAGRAM-PLAN.md.
--
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

  -- The `updated_at` bump is load-bearing: the delta pull (ALG-4) only fetches rows with
  -- `updated_at > cursor`, and LWW only replaces a local row with a NEWER one. The cursor is the
  -- max client-authored `updated_at` a device has seen, so a device whose clock ran ahead could
  -- hold a cursor past the server's now(); bumping past the table's current max as well puts every
  -- rewritten row strictly after any cursor and any local copy. (The subquery is uncorrelated, so
  -- it is evaluated once, against the pre-update rows.)
  update public.stamps
     set scale = scale * 35.0 / 48.0,
         updated_at = greatest(
           now(),
           (select max(updated_at) from public.stamps) + interval '1 millisecond'
         );

  update public.placed_stickers
     set scale = scale * 35.0 / 48.0,
         updated_at = greatest(
           now(),
           (select max(updated_at) from public.placed_stickers) + interval '1 millisecond'
         );

  insert into public.data_migrations (name) values ('cells_8x5');
end $$;
