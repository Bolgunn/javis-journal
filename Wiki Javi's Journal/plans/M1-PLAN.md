# M1 — Foundation + Auth (US-1) — Execution Plan

Resolved via grill session 2026-07-05. This is the plan `parallel-plan` executes.

## Goal
Deliver US-1 (auth locked to Javi): Google OAuth → server-side allowlist gate →
first-login profile provisioning, on top of the full Postgres data model + private
Storage bucket. Calendar UI itself is out of scope (that's M4); a minimal authed
placeholder page is enough.

## Ground rules for every task
- **This is NOT the Next.js you know (v16.2.10).** Before writing any Next.js / App
  Router code, read the relevant guide under `node_modules/next/dist/docs/`. Heed
  deprecation notices. Do not assume training-data APIs.
- Use `@supabase/ssr` (v0.12) for browser + server clients; `@supabase/supabase-js`
  (v2.110) for the service client.
- **Env-var contract (new Supabase key format — already in `.env.local`):**
  - Browser: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
  - Server: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`
  - Gate/recovery: `OWNER_OVERRIDE_EMAIL`
  - Health cron: `CRON_SECRET` (Vercel standard `Authorization: Bearer`), fallback `HEALTH_PING_SECRET`
  - Do **not** use the legacy `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
    names — they are empty and wrong for this project.
- CSS Modules only (soft pastel). No new dependencies.
- `npm run lint` and `npm run build` must pass at the end of each task.

## Definition of done
Signing in with an allowlisted Google account reaches the app; a non-allowlisted
account is denied and signed out; the owner-override email always gets in. Schema +
RLS + bucket exist in the linked Supabase project after `supabase db push`.

---

## DAG
```
Task 1 (DB migration) ─┐
                       ├─► (both leaves, run in parallel)
Task 2 (Auth core) ────┘
                       └─► Task 3 (UI + edges)   [depends on Task 2's browser client]
```

---

## Task 1 — DB migration  *(leaf · parallel with Task 2 · pure SQL)*
**File:** `supabase/migrations/0001_init.sql`

Author the complete schema exactly per `Wiki Javi's Journal/SCHEMA.md` DDL, plus:
- `create extension if not exists pgcrypto;`
- All tables: `allowed_emails`, `profiles`, `images`, `entries`, `stamps`,
  `sticker_assets`, `placed_stickers` — with all columns, checks, defaults, FKs.
- All indexes listed in SCHEMA.md (including partial `stamps_entry_live_idx` and the
  `(user_id, updated_at)` sync indexes).
- The `enforce_stamp_cap()` function + `stamps_cap_trg` BEFORE INSERT trigger.
- **RLS**: enable RLS on every user-owned table (`profiles`, `images`, `entries`,
  `stamps`, `sticker_assets`, `placed_stickers`) with policies `auth.uid() = user_id`
  for select/insert/update/delete. `allowed_emails` has RLS enabled with **no**
  public policy (only the service key reads it).
- **Storage**: create a **private** bucket `images`
  (`insert into storage.buckets (id, name, public) values ('images','images',false)`),
  plus storage RLS policies on `storage.objects` for the `images` bucket restricting a
  user to their own prefix: `auth.uid()::text = (storage.foldername(name))[1]` for
  select/insert/update/delete.
- **No personal emails** in this file. Seeding `allowed_emails` is a separate manual step.

Idempotency: use `if not exists` / `create or replace` where sensible so re-runs are safe.

---

## Task 2 — Auth core  *(leaf · parallel with Task 1)*
**Files:** `src/lib/db/types.ts`, `src/lib/supabase/{browser,server,service}.ts`,
`src/lib/auth/allowlist.ts`, `src/app/api/auth/gate/route.ts`, `middleware.ts`

1. **`src/lib/db/types.ts`** — shared TypeScript row types for every table in
   SCHEMA.md: `AllowedEmail`, `Profile`, `ImageRow`, `Entry`, `Stamp`, `StickerAsset`,
   `PlacedSticker`. Mirror column names/types (snake_case to match Postgres). Include
   the `mask_type` and `rotation_deg` unions. No Dexie here (that's M2).
2. **`src/lib/supabase/browser.ts`** — `createBrowserClient(url, publishableKey)`.
3. **`src/lib/supabase/server.ts`** — `createServerClient` with Next 16 async
   `cookies()` from `next/headers` (get/set/remove per `@supabase/ssr` docs).
4. **`src/lib/supabase/service.ts`** — server-only `createClient` from
   `@supabase/supabase-js` using `SUPABASE_URL` + `SUPABASE_SECRET_KEY`,
   `auth: { persistSession: false }`. Used to read `allowed_emails` past RLS. Never
   import into client code.
5. **`src/lib/auth/allowlist.ts`** — `isAllowed(email: string): Promise<boolean>` =
   `email === OWNER_OVERRIDE_EMAIL` OR a service-client `allowed_emails` lookup returns
   a row. Case-insensitive compare.
6. **`src/app/api/auth/gate/route.ts`** — GET handler (OAuth redirect target):
   - Read `code` from the request URL. If missing/error → redirect `/login?error=oauth`.
   - Server client `exchangeCodeForSession(code)` (writes session cookies).
   - Read the authed user's email. `isAllowed(email)`:
     - **allowed** → upsert `profiles` (`user_id`) with defaults → redirect `/`.
     - **denied** → `supabase.auth.signOut()` → redirect `/denied`.
7. **`middleware.ts`** — `@supabase/ssr` session-refresh pattern. Redirect no-session
   requests to `/login`; redirect a signed-in user hitting `/login` to `/`. Matcher
   must exclude `/api/auth/gate`, `/denied`, static assets (`_next`, favicon, images).

---

## Task 3 — UI + edges  *(depends on Task 2's `lib/supabase/browser`)*
**Files:** `src/app/login/page.tsx` (+ `login.module.css`),
`src/app/denied/page.tsx` (+ `denied.module.css`), `src/app/page.tsx` (replace boilerplate),
`src/app/api/health/route.ts`, `vercel.json`, `.env.local.example` (rewrite to the real
key names)

1. **`src/app/login/page.tsx`** — client component. Centered CSS-Module card on a soft
   pastel bg: "Javi's Journal" title + one "Sign in with Google" button →
   `browserClient.auth.signInWithOAuth({ provider: 'google', options: { redirectTo:` `${location.origin}/api/auth/gate` `} })`. Loading + error states. Clean, minimal — no fonts/illustrations (real polish is M10).
2. **`src/app/denied/page.tsx`** — neutral "Access denied" message + a sign-out/back
   link. **No "this journal is private" copy.**
3. **`src/app/page.tsx`** — replace the create-next-app boilerplate with a minimal
   authed placeholder (server component; middleware guarantees a session): greet the
   signed-in email + "Your calendar arrives in M4." Remove `page.module.css` cruft.
4. **`src/app/api/health/route.ts`** — GET; verify `Authorization: Bearer ${CRON_SECRET}`
   (fallback `HEALTH_PING_SECRET`); run a trivial `select 1` via the service client to
   keep Supabase warm; return `200 {ok:true}`; `401` on bad secret.
5. **`vercel.json`** — `{ "crons": [{ "path": "/api/health", "schedule": "0 8 * * *" }] }`
   (daily — Supabase pauses after ~1 week idle; daily fits the Vercel Hobby cron limit).
6. **`.env.local.example`** — rewrite to the real contract: `NEXT_PUBLIC_SUPABASE_URL`,
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY`,
   `OWNER_OVERRIDE_EMAIL`, `CRON_SECRET`. Drop the legacy anon/service-role names.

---

## Manual steps (owner — not for agents)
Already done: Supabase project created + CLI-linked; Google OAuth client (Web app) with
redirect URI `https://hhvenfugqragfrylzwws.supabase.co/auth/v1/callback`; Google provider
enabled in Supabase with client id/secret; Supabase URL config (Site URL + redirect URLs);
consent screen in Testing with test users (the owner's two Google accounts).

Remaining after the agents finish:
1. In `.env.local`: set `OWNER_OVERRIDE_EMAIL` to the owner's email; set `CRON_SECRET`
   (any random string) for later deploy.
2. Apply the schema: `supabase db push`.
3. Seed the allowlist (Supabase SQL editor, **not** committed):
   `insert into allowed_emails (email, note) values
   ('<owner email>','owner'), ('<test email>','tester');`
4. `npm run dev` → sign in with a test account → land on `/`. Try a non-listed account
   → `/denied`. Verify owner-override still works with the allowlist empty.
