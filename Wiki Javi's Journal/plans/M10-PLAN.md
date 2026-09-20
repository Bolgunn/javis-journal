# M10 — Stability gate + polish + ship (US-13 hard gate, US-14) — Execution Plan

Resolved via grill session 2026-07-15, against the seams M1–M9 already built (the `/dev/*`
harnesses + per-surface object-URL canaries, the `Stamper` eject placeholder, `dexie-react-hooks`
query seams, `allowed_emails` + `OWNER_OVERRIDE_EMAIL`, `profiles.fireworks_seen`). This is the
plan the build phase executes.

> **Deadline reality: today is 2026-07-15; ship target is 2026-07-18 — three days.** M10 is the
> heaviest convergence milestone, so scope is deliberately cut to the ship-critical spine. **Anything
> that looks like reopening a settled decision (the theme, the schema, a new dependency) is out.**

## Goal
Close the two remaining stories and ship the birthday edition:
- **US-13 (hard gate):** prove the app stays fast after months of use — memory/FPS stable across a
  simulated 30–60 day run; history virtualized; month view loads thumbnails only, never full-res.
- **US-14 (cozy cutter):** cutting a stamp plays a satisfying animation + sound, respecting the
  device's silent/mute setting, and **never blocks or delays the placement/save**.
- **Ship:** deploy verified on the production URL, cross-device sync confirmed, Javi's accounts
  allowlisted, the owner-override recovery path tested so a bad first login can't lock her out.

### Scope cuts (decided in the grill)
- **Birthday fireworks: CUT from M10.** The owner judged it "a little too much" for now. No trigger
  is wired; `profiles.fireworks_seen` stays a harmless unused column. Parked, not deleted — revisit
  post-ship.
- **Aesthetic: pastel is LOCKED.** No palette/font exploration, no theme reopening. The `paper`/
  `scrapbook` dev themes stay behind `/preview` (zero runtime cost). Polish is a **bounded** sweep,
  not a redesign.

## Resolved decisions

### A — The long-run stability hard gate (US-13)

1. **Two-tier gate — the same posture as every prior milestone.** The single acceptance criterion
   ("simulated 30–60 day run, memory/FPS stable") splits cleanly across the tiers because jsdom has
   no real decode/heap:
   - **Tier-1 (automated, the CI merge gate)** measures **accounting, not bytes**: a **whole-app
     integration harness** drives the *real* `Calendar` island (not isolated components) through a
     scripted 30–60 in-app-"day" tour — mount month → open several day pages → cut a stamp → place
     stickers → switch frame → navigate month → repeat — and asserts the invariants that actually
     cause the freeze: **live object-URL count stays flat** (≤ one month's worth), **mounted-cell
     count stays bounded** (virtualization holds), **Dexie live-query subscriptions balance** (every
     `useMonthData`/`useDayView` mount has a matching unsubscribe on unmount), and **every full-res
     bitmap `close()`s** (assert `close` called once per stamper open — the stamper decode leak is
     the cross-surface bug the isolated canaries can't see). Fixtures are **small deterministic
     tagged blobs** (a few KB) — blob size is irrelevant to handle-counting; faking 20 MB in jsdom is
     theater. One size-correctness check rides along: **the grid references the `thumb` blob, never
     `main`/original** (a tag mismatch is the freeze bug in miniature).
   - **Tier-2 (owner gate, the real hard-gate sign-off)** owns "realistic photos + real memory": the
     seeded 60 days use genuine 8–20 MB HEIC/JPEG fixtures, real decode, real heap, watched in Chrome
     DevTools on the Pixel 9. **Pass line:** heap **sawtooths** (returns to within ~10% of baseline
     after navigating away + GC — no monotonic climb) and FPS stays smooth during scroll/pinch over
     the seeded 60 days.

2. **The M10 harness is a superset above the retained per-surface canaries, not a replacement.** The
   `/dev/calendar`, day-page, and M7 sticker canaries stay exactly where they are (they *localize* a
   regression); the M10 harness sits above them and exists for the **seams between surfaces** — day
   page × stamper decode, sticker layer × frame × 42 thumbs live together, month churn × Dexie
   subscriptions. The freeze is an emergent whole-app property; the gate must exercise the whole app.

### B — Cozy cutter: sound (US-14)

3. **The asset is built and in the repo: `public/stamper/cut.mp3`** — 0.26 s, mono, ~4.6 KB.
   Sourced from freesound.org sound **#11738 "scissors_cut_paper.wav" by xyzr_kx (CC0**, no
   attribution required), the fuller "snip" trimmed and softened (high-frequency roll-off) so it
   reads warm rather than harsh. Provenance recorded here per CC0 courtesy. **Format is MP3, not
   AAC/`.m4a`** — `decodeAudioData` handles MP3 in every target browser (Safari/iOS included) with no
   container edge cases; at 0.26 s the size difference is nil.

4. **Play on eject-start, never on press — so it is structurally impossible to hear over a failed
   bake.** The sound fires the instant `setEjecting(true)` runs (i.e. *after* `bakeStamp` +
   `ingestStamp` resolve), synced to the stamp emerging. The press already gives tactile feedback
   (plate depresses, label → "cutting…"). This preserves the fail-closed invariant: a bake that
   throws sets `ejecting=false` and shows the error — the snip never plays over a failure.

5. **A local-only mute toggle is the deterministic control; OS-silent-switch respect is best-effort.**
   The web exposes **no API to read the iOS silent switch**, so "respecting silent mode" cannot be
   done by reading a flag. Two layers:
   - **In-app toggle (deterministic, we own it):** "Cut sound: On/Off" in the 3-dots menu, persisted
     to **`localStorage`, NOT synced** (mute is inherently per-device — phone-in-pocket vs desktop
     speakers), default **On**. **No schema change, no `supabase db push`** for the toggle.
   - **OS silent switch (best-effort):** we play through an audio path and let the platform govern
     it. iOS WebAudio-vs-`HTMLAudioElement` silent-switch behavior is murky and version-dependent, so
     the audio module exposes one `playCut()` behind which the backing (WebAudio buffer vs a plain
     `HTMLAudioElement`) can be swapped; **Tier-2 on her actual iPhone is the arbiter** of which
     respects her silent switch. The in-app toggle is the guarantee regardless of how iOS behaves.
   - The `AudioContext`/element is **unlocked inside the drawer-press gesture** (a real user gesture),
     so no autoplay block. Any load/decode/play failure is **swallowed silently** — audio never
     touches the cut/bake/placement path.

### C — Cozy cutter: animation (US-14)

6. **The eject flourish already exists (built in M6) — M10 *upgrades* it, nothing architectural.**
   `Stamper.onCut` already awaits the bake (sole authority), then runs the `ejecting` beat
   (`punch-eject` keyframe, `EJECT_MS = 260`), then `onConfirm`; a failure already sets
   `ejecting=false` + shows the error. The agreed Q4 sequencing is *already the shipped structure*.
   Today the thing that emerges is a **blank paper square** and there is **no sound**. M10's three
   targeted changes:
   - **Emerge the *real* baked stamp, not a blank square.** `bakeStamp` already returns `thumbBlob`;
     hold a temporary object URL for it, render *that* (its true WebP-alpha shape — heart/cloud
     corners transparent) in the eject element, and **revoke on confirm**. She watches *her* stamp
     drop into the drawer. Small change, whole delight.
   - **Play the snip at eject-start** (decision 4).
   - **Degrade gracefully:** `prefers-reduced-motion` → skip the beat entirely (straight to
     `onConfirm`, as the FLIP zoom already does); audio gated by the mute toggle + OS switch; any
     hiccup swallowed — the cut/save always succeeds.
   - **Parked for v1:** a drawer→placement FLIP (morphing the drawer stamp into its placed position
     on the day page). Lovely, but couples two surfaces; the clean cut→day-page transition exists.

### D — Bounded polish sweep

7. **Only these, time-boxed — correctness-adjacent, not taste:** the **3-dots menu** stays coherent
   as it gains the mute toggle (order + styling consistent with Change frame / Change month / Logout /
   Download PNG); the **"offline — will sync" hint** (ALG-3) actually renders and reads well; the
   **loading/empty states** (opening photo, empty day, no-stamps) aren't ugly; **tap-target/spacing**
   consistency on a real phone. No new screens, no restyle.

### E — Ship

8. **Verify on the PRODUCTION URL under a throwaway test account — never localhost.** Every
   verification (Tier-2 freeze, cross-device, cutter, stickers, frames, owner-override) runs against
   the real deploy. RLS is per-user (`auth.uid() = user_id`), so a test account's data can **never**
   appear in Javi's account — the clean-account property is free.

9. **Javi's two accounts are allowlisted NOW (owner's call — not held to the last step).**
   Migration `supabase/migrations/20260715000000_allow_javi.sql` adds **her two Gmail addresses**
   (she uses both; the file is now emptied — allowlist rows live in the SQL editor, see WORKFLOW-PLAN). **Owner runs `supabase db push`** to apply it to
   hosted Supabase (migrations are not auto-applied — see the storage-needs-db-push lesson). Safe to
   add early: the allowlist entry creates no data; RLS keeps her account clean regardless of timing.
   The only effect is she *could* sign in early *if* she had the production URL (she doesn't yet).

10. **Owner-override recovery = three assertions on production, #3 load-bearing.** `OWNER_OVERRIDE_
    EMAIL` (the owner's email) bypasses `allowed_emails` entirely:
    - (1) an allowlisted email → reaches the calendar;
    - (2) a non-allowlisted email → denied;
    - (3) **`OWNER_OVERRIDE_EMAIL`, deliberately *absent* from `allowed_emails`, → still reaches the
      calendar.** This is the actual recovery guarantee — the escape hatch works even when the
      allowlist is wrong, so a botched allowlist or a bad first mobile popup-auth can't lock Javi out.

11. **The OAuth redirect URI repair is the OWNER's task** (the one manual M1 leftover — auth is dead
    on the production domain without it). It is a hard ship-blocker; the owner-override test (#10) and
    Javi's first login both depend on it. **Owner confirms this is done before the go-live check.**

12. **Final go-live check (one clean first-login as Javi, after the blockers pass):** profile row
    created, **3 seeded stickers present** in her tray (M7's deterministic-id ingest), week-start =
    Monday, no stray data. Then hand it over.

## Ground rules for every task
- **This is NOT the Next.js you know (v16.x).** Read `node_modules/next/dist/docs/` before touching
  `src/app/**`.
- **Package manager is pnpm.** `pnpm lint` + `pnpm build` green at the end of **every** task;
  `pnpm test` green by the last. No regression to the 281 tests green on master today.
- **Reuse the seams.** Audio is a new tiny module; everything else wires into existing seams
  (`Stamper` eject, `CalendarMenu`, the query hooks). Components never touch `db.*`/Supabase directly
  outside the established seams.
- **No schema change, no Dexie bump, no new dependency** for the app code (the audio is a static
  asset + a `localStorage` pref). The only DB change is the allowlist-insert migration (owner
  `db push`). If the build discovers otherwise, stop and say so.
- **Build:** direct, single-thread, branch `m10-ship` off `master`. **Not** `/parallel-plan`. Commit
  per task, conventional message, **no `Co-Authored-By` trailer**.
- **Look at the output.** The cut is aud-visual and the freeze gate is a real-device property — the
  owner runs the Tier-2 gates; do not claim US-14/US-13 done from unit tests alone.

## Task DAG

```
   T1 audio module ──────► T2 Stamper wiring (sound + real-stamp eject) ──► T3 mute toggle in CalendarMenu
                                                                                    │
   T4 long-run integration harness (Tier-1)  ─────────────────────────────────────┤ (independent)
                                                                                    │
   T5 bounded polish sweep  ──────────────────────────────────────────────────────┤ (independent)
                                                                                    │
   T6 allowlist migration (DONE) ──► owner `supabase db push`                       │
                                                                                    ▼
                              SHIP VERIFICATION (owner-run, production URL)
                    OAuth fix ▸ owner-override (3 assertions) ▸ cross-device ▸ Tier-2 freeze ▸ Javi first-login
```

- **T1 — audio module** (`src/lib/audio/cut-sound.ts` or similar). One `playCut()` (gesture-unlocked,
  decode-once/cache, swallow all failures) + a `soundEnabled()` / `setSoundEnabled()` `localStorage`
  pref (default on). Backing swappable (WebAudio buffer ↔ `HTMLAudioElement`) for the Tier-2
  silent-switch arbitration. *Unit tests: pref get/set default-on; play is a no-op when muted; a
  failing decode/play never throws.*
- **T2 — Stamper wiring.** Call `playCut()` at `setEjecting(true)` (decision 4). Replace the blank
  eject square with an `<img>` of `bake.thumbBlob`'s object URL (revoke on confirm/unmount).
  `prefers-reduced-motion` → skip the beat. *Test: eject renders the baked thumb; object URL revoked;
  reduced-motion path calls `onConfirm` without the delay.*
- **T3 — mute toggle in `CalendarMenu`.** "Cut sound: On/Off" item, reads/writes the T1 pref, styled
  with the existing menu items.
- **T4 — Tier-1 long-run integration harness** (`/dev/longrun` + assertions). Drives the real
  `Calendar` island through a 30–60 "day" tour with small tagged fixtures; asserts flat object-URL
  count, bounded mounted cells, balanced Dexie subscriptions, `close()`-per-stamper-open, and
  thumb-not-main. This is the automated hard gate.
- **T5 — bounded polish sweep** (decision 7). Menu coherence, offline hint, loading/empty states,
  tap targets. No new screens.
- **T6 — allowlist migration** (DONE: `20260715000000_allow_javi.sql`). Owner `supabase db push`.

## Definition of done

**Tier 1 — automated (`pnpm lint`, `pnpm build`, `pnpm test` all green):**
- **Long-run harness (T4):** across a scripted 30–60 "day" tour of the real island — live object-URL
  count flat, mounted-cell count bounded, Dexie subscriptions balanced (mounts == unmounts), one
  bitmap `close()` per stamper open, and the grid references `thumb` not `main`. No regression to the
  M2–M8 suites (281 tests green today).
- **Audio (T1):** pref defaults on; muted → `playCut()` is a no-op; decode/play failure never throws.
- **Stamper (T2):** eject shows the baked `thumbBlob`; object URL revoked on confirm; reduced-motion
  skips the beat; a bake failure still shows the error and plays nothing.

**Tier 2 — owner-run (real device gates):**
- **US-14:** the cut plays the emerging *real* stamp + the snip; sound obeys the in-app toggle; on the
  iPhone, confirm whether the silent switch mutes it (arbitrate WebAudio vs `HTMLAudioElement`); the
  flourish never delays placement; reduced-motion degrades cleanly.
- **US-13 hard gate:** the seeded-60-day Pixel-9 run — heap sawtooths back to ~baseline, FPS smooth on
  scroll/pinch; month view loads thumbnails only.
- **Ship (production URL):** OAuth redirect fixed (owner); owner-override 3 assertions pass (#3 the
  recovery guarantee); cross-device sync (create on one session → appears on another, LWW); Javi's
  first login clean (profile + 3 seeded stickers + Monday + no stray data).

The owner merges `m10-ship` → `master`, runs `supabase db push`, runs the Tier-2 + ship gates, then
gifts it.
