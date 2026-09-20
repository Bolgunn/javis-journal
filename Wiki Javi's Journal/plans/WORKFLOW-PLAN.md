# Workflow plan — CI, branch rules, and how change reaches her phone

> Not a milestone. M1–M9 shipped (M10 is on `m10-ship`, unmerged). This sets up the workflow
> every *future* change goes through. Resolved via `/grill-me`, 2026-09-20.

## The premise

From here on, `master` is not "the latest code" — it is **what is on Javi's phone**, holding real
data that has no backup. Until now nothing was verified anywhere except by hand on one laptop:
no CI, no branch rules, 281 tests nothing enforced, and migrations pushed from memory.

Goal: a **working safety net**, not a portfolio. Ceremony that catches nothing is cut.

## Decisions

### 1. Trunk-based. No `develop`.
Short-lived `feat/*` · `fix/*` · `chore/*` branches → PR → CI → rebase-merge to `master`.

Rejected: **`develop` on the same DB** (the one Supabase project means a develop deploy writes to
her live data — staging in name only, and a double merge on every change); **`develop` + a second
Supabase staging project** (real safety, declined for its standing sync/setup tax).

### 2. Development stays against production.
No local Supabase, no DB backups — both declined deliberately. Consequence, accepted: production
data is unrecoverable, and **when you test on a preview URL or `pnpm dev`, you are signed into her
real journal.** Everything below exists because that's true.

### 3. CI (GitHub Actions) — two jobs, both hard blockers
| job | runs | on |
|---|---|---|
| `check` | `pnpm lint` · `pnpm typecheck` (new: `tsc --noEmit`) · `pnpm test` | every PR + push to `master` |
| `migrations` | `supabase db reset` on a throwaway Postgres (proves the chain replays from zero) | every PR + push; **no-ops to success** unless `supabase/migrations/**` changed |

- **Vercel owns `next build`** — it already builds every PR; its check is required in the ruleset.
- `typecheck` is the only new coverage: `next build` never typechecks the 37 test files.
- CI uses **dummy env values** — every env read is lazy (`requireEnv` inside functions) and every
  Supabase route is dynamic, so nothing real is needed. **No secrets in GitHub.**
- ⚠ The `migrations` job must **always run and report**, skipping internally — a workflow-level
  `paths:` filter leaves a required check "Expected — waiting" forever on PRs that don't touch it.
- Node pinned via `.node-version` to what Vercel runs; `@types/node` bumped to match.

### 4. Ruleset on `master` — Active, **empty bypass list**
Require PR · required checks: `check`, `migrations`, Vercel · require linear history · block
force-push + deletion · **0 approvals** (GitHub forbids self-approval; 1 would deadlock).
Escape hatch = flip the ruleset to Disabled: deliberate, never drift.

The PR is also the **Tier-2 device rig**: every PR gets a Vercel preview — open it on the phone
and actually pinch the thing before it reaches her. (Safe on a public URL: `proxy.ts` gates
everything but `/preview` behind auth + the allowlist.)

### 5. Merges: rebase (multi-commit) or squash (one-liners); merge commits disabled
Preserves the documented *commit-per-task* methodology. Record PR numbers in plan docs, not
branch SHAs (rebase rewrites them). Auto-delete head branches on merge.

### 6. Repo stays public; emails scrubbed at HEAD only
The three seed migrations (`20260706022319`, `20260713120000`, `20260715000000`) are emptied to a
comment. **The allowlist is data, not schema** — rows are managed in the Supabase SQL editor.
Editing applied migrations is safe: `db push` tracks versions, not content.

Rejected: **history rewrite** (GitHub keeps old SHAs reachable anyway; breaks the SHAs recorded in
`dag-state*.json` and the M8 plans; force-push to the branch we're making sacred); **env-var
allowlist** (would need a `drop table` on an unbacked-up DB).

### 7. Migrations: manual push, checklisted — and **additive-first**
`supabase db push` stays a manual step, enforced by the PR template checklist. Auto-apply via a
gated GitHub Environment was declined.

Because timing is now manual, migrations follow **expand/contract**: add in one PR, stop reading
the old shape, drop it in a *later* PR — so code and schema work in either order. This rule goes
in AGENTS.md.

### 8. Issues are the inbox; Obsidian is the design layer
What she reports becomes a one-line issue (labels: `bug`, `idea` — nothing else, no templates, no
board). Anything that needs a plan still gets grilled into `plans/`. PRs say `closes #N`.

### 9. Dependencies: Dependabot security alerts + security updates only
Version bumps by hand, `pnpm update` at the start of a feature branch, proven by CI.

## Task DAG

Sequential — the ruleset needs the check names to exist first, and everything lands before M10.

1. **`chore/workflow` branch** — `typecheck` script; `.node-version` + `@types/node`;
   `.github/workflows/ci.yml` (both jobs); `.github/pull_request_template.md` (migration
   checklist); scrub the three migrations; AGENTS.md "Workflow" section (branches, PR flow,
   expand/contract, allowlist-is-data). `pnpm lint && pnpm typecheck && pnpm test` green locally.
2. **Open the PR**, watch CI run green on GitHub, confirm the exact check names, rebase-merge.
3. **Repo settings** — merge commits off, rebase + squash on, auto-delete head branches,
   Dependabot alerts + security updates on, labels `bug`/`idea`, **ruleset created** with the
   check names from step 2.
4. **`m10-ship` through the gate** — rebase on `master` (merges clean — 5 commits), PR, CI,
   preview on the phone, rebase-merge. Proves the whole setup end-to-end.
5. **Delete stale branches** (local + remote): `m4-calendar` `m5-stamper` `m6-day-editor`
   `m7-stickers` `m8-frames` `m9-export` `ui-design` `preview/stamper` — all verified merged or
   content-empty.

## Definition of done
- A PR that breaks a test / type / lint rule / build / migration replay **cannot be merged**.
- A direct `git push origin master` is **rejected**.
- `m10-ship` is on `master`, merged through the gate; only `master` remains.
- No personal email in any file at HEAD.
- AGENTS.md describes the workflow, so every future session follows it.
