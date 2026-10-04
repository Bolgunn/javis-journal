# M11 build kickoff prompt — Guest mode (US-15)

*(Design is already done. Paste everything below the line into a fresh session to execute the
build. The resolved decisions live in `Wiki Javi's Journal/plans/M11-PLAN.md` — read it first; it
is the contract.)*

---

Build **M11 — Guest mode (US-15)** for Javi's Journal, from the resolved plan through to an open,
green PR. The design phase is complete: **`Wiki Javi's Journal/plans/M11-PLAN.md`** holds the 8
resolved decisions, the task DAG (Tasks 1–5) and the Definition of done. **That plan is the
contract — read it fully before writing a line.** Do not re-litigate its decisions; if the build
surfaces a genuine contradiction, stop and flag it rather than quietly diverging.

## Why this exists (so the priorities are clear)

The repo is on the owner's CV. A recruiter must be able to **try the real app** without an account,
while it stays **structurally impossible** for anyone but Javi to write a row or upload an image to
Supabase. `master` is on Javi's phone with real data and **no backup** — so the second half of that
sentence outranks the first. When in doubt, choose the option that cannot reach the network.

## The shape of the milestone (so nothing surprises you)

M11 is a **client-identity change, not a data change.** **No migration, no `supabase db push`, no
RLS/storage policy change, no allowlist change, no Dexie version bump (stays v5), no new
dependency.** If you find yourself reaching for any of those, a plan decision was wrong — stop and
say so.

The spine, in one rule: **guest mode swaps the identity source and switches off the sync transport;
everything in between is the same code Javi runs.**

- A guest has **no Supabase session at all** — a cookie, `jj_guest=1`, is the whole identity, and
  rows use `GUEST_USER_ID = "guest"`. **Not** `signInAnonymously` (anonymous users pass
  `auth.uid() = user_id` — decision 1).
- Guests live in a **separate IndexedDB, `"javis-journal-guest"`**, chosen once at module load
  (decision 2). The 18 importers of `db` must not learn guest mode exists.
- `markDirty` **still writes the outbox** for guests; the engine simply never drains it
  (decision 5). Do not add a guest branch to `markDirty`/`outbox.ts`.
- A real Supabase session **always beats** the cookie; `/api/auth/gate` clears `jj_guest` on a
  successful sign-in (decision 4).

## Read before building

1. **`Wiki Javi's Journal/plans/M11-PLAN.md`** — the resolved plan. `PLAN.md` US-15 for the
   acceptance criteria.
2. `AGENTS.md` / `CLAUDE.md` — the project guide. **This is Next.js v16.x, not the one you know**:
   read `node_modules/next/dist/docs/` before touching `src/app/**` or `src/proxy.ts` (cookies in a
   route handler, `cookies()` in a server component, and the proxy — formerly middleware — all
   changed). M11 touches all three.
3. **The code you will change — read each before editing:**
   - Server gates: `src/proxy.ts` (the redirect rules + the `matcher` exclusion list),
     `src/app/page.tsx` (its own `getUser()` redirect), `src/app/api/auth/gate/route.ts` (clear the
     cookie on success), `src/app/login/page.tsx`, `src/app/denied/page.tsx`.
   - Database: `src/lib/db/index.ts` (`JournalDB` + the `db` singleton — hard-wired to
     `"javis-journal"` today).
   - Identity call sites (the table in decision 5): `src/lib/image/ingest.ts` (`currentUserId`),
     `src/lib/stamp/ingest-stamp.ts`, `src/lib/db/mutations.ts` (`setStartOfWeek`/`setSelectedFrame`
     fallback), `src/lib/sync/engine.ts` (`startSyncLoop`/`flushNow` — **the transport choke
     point**; note `ingest.ts` calls `scheduleFlush()` directly, which lands in `flushNow`),
     `src/components/SyncBoot.tsx`, `src/lib/image/thumb-url.ts` (the signed-URL fallback),
     `src/lib/db/preview-guard.ts` (`editingLocked`), `src/components/calendar/CalendarMenu.tsx`
     (logout), `src/components/calendar/Calendar.tsx` (~line 243, the `repairStickerThumbs` →
     `seedStickers` effect).
   - Read seam: `src/lib/db/queries.ts` `useProfile` (`userId` is null until a profile row exists —
     why the guest bootstrap is needed).
   - Title row for the pill: `src/components/calendar/MonthTitle.tsx` / `TopBar.tsx` — the pill
     must sit **outside** `FramedGrid` so `cellW` and the export are untouched.
4. The existing tests that show the patterns: `src/lib/db/preview-guard.test.ts` (stubbing
   `NEXT_PUBLIC_VERCEL_ENV`), `src/lib/sync/engine.test.ts` + `test-utils.ts` (fake-indexeddb,
   mocking `@/lib/supabase/browser`), `src/lib/image/day-canary.test.ts` (the canary style the
   no-network test should echo).

## Build order (the DAG in M11-PLAN.md)

You are on **`feat/guest-mode`** (the plan docs are already committed there; `master` is protected
— never push it). Build **directly, one thread — do NOT use `/parallel-plan`**.

- **Task 1 — Identity seam + guest DB.** `src/lib/auth/identity.ts` (`isGuest`, `GUEST_USER_ID`,
  `guestProfileBootstrap`, server-side `isGuestRequest`); `JournalDB(name)` + the singleton choosing
  the guest name. *Tests.*
- **Task 2 — Server side.** `GET /api/auth/guest` (set cookie → `/`) + matcher exclusion; proxy
  guest pass-through and `/login` bounce; `page.tsx` accepts guests; gate clears `jj_guest`.
  *Tests: the proxy decision table.*
- **Task 3 — Transport off + call sites.** Engine + `SyncBoot` guards; ingest/ingest-stamp/mutations
  identity; `thumb-url` fallback skip; `editingLocked()` false for guests; no seed/repair for
  guests; bootstrap on guest boot. *Tests.*
- **Task 4 — UI.** "Try it as a guest" on `/login` + `/denied`; the "Guest · saved on this device
  only" pill; "Exit guest mode" in the 3-dots menu (clears the cookie → `/login`, no `signOut`,
  no confirm, **does not delete the guest DB** — decision 3).
- **Task 5 — No-network canary + docs.** The canary (DoD 3); `CLAUDE.md` status entry + layout
  line for `src/lib/auth/identity.ts`; `PLAN.md` if anything moved; a README "try it as a guest"
  line.

Commit per task with a conventional message (`feat:`/`fix:`/`test:`/`docs:`), **no
`Co-Authored-By` trailer** (repo convention). `pnpm lint`, `pnpm typecheck`, `pnpm test` and
`pnpm build` green at the end of **every** task. Styling is Tailwind v4 (CSS-first `@theme` in
`globals.css`, no `tailwind.config.js`); the button and pill must work under the shipped `pastel`
theme and reuse the login card's existing visual language.

## The decisions most likely to bite if you skim

- **The cookie is read in two worlds.** Server: `proxy.ts` and `page.tsx` via one
  `isGuestRequest()` helper — they must not drift. Client: `isGuest()` from `document.cookie`, hence
  `httpOnly: false`. `isGuest()` must return `false` on the server and in tests unless stubbed,
  and must never throw.
- **"Session beats cookie" is enforced in two places**: the proxy/home treat a real user as a real
  user regardless of the cookie, and the gate clears the cookie. The client DB choice only reads the
  cookie, so the gate clearing it is what keeps Javi out of the guest DB — test it.
- **The singleton is chosen at module load.** Every mode switch must be a full navigation
  (`window.location.assign`, a server redirect) — never a client-side `router.push` between guest
  and signed-in, or the wrong DB stays open.
- **Bootstrap never overwrites.** `guestProfileBootstrap()` writes only if no profile row exists; a
  returning guest keeps their frame and week start.
- **Seeding is skipped, and so is the repair.** A guest's tray starts empty (decision 6).
- **The canary is the point of the milestone.** Mock `@/lib/supabase/browser` so **every** method
  throws, set the guest cookie, then run: boot → bootstrap → set frame + week start → ingest a photo
  → cut/create a stamp → update → delete → restore → upload + place a sticker → export a PNG (the
  `exportMonthPng` data path at least) → advance timers past the 800ms debounce and the 60s pull
  interval. Assert the client factory was **never called**. If a path is too DOM-heavy for vitest,
  test its lowest seam and say which in the PR.

## Verification (two-tier, as M3–M9)

- **Tier 1 (yours):** the plan's DoD 3–4 tests, **no regression** to the existing suite (359 green on
  `master`), and the flow in the browser preview: `/login` → guest → empty calendar with the pill →
  add a photo → reload → still there → Exit → `/login` → guest again → photo restored. Check the
  network panel for zero Supabase requests during the guest flow.
- **Tier 2 (owner-run, on the PR preview):** DoD 5 — guest on the phone, then the Supabase dashboard
  shows no new rows/objects, then the owner signs in on the same phone and sees none of the guest's
  data. **Do not block on it yourself.**

When it is green, push `feat/guest-mode`, open a PR against `master` (`closes #N` if an issue
exists; the PR template's migration checkbox is N/A — say so), and stop and report. The owner runs
Tier-2 on the preview and rebase-merges.
