// M11 — the identity seam (M11-PLAN decisions 1, 2, 4, 5). The ONE place that knows guest mode
// exists: every "am I a guest" question in the app goes through here, client and server alike.
//
// A guest has no Supabase session at all. The `jj_guest=1` cookie is the whole identity, and
// guest rows carry `GUEST_USER_ID`. The cookie is unsigned on purpose: hand-setting it grants
// nothing server-side (no session, no rows, no storage). It only unlocks pages that render from
// the visitor's own IndexedDB — and it selects that IndexedDB (`db`, see `@/lib/db`).
//
// Pure and DOM-guarded: no Dexie, no Supabase, no `next/*` import, so `@/lib/db` can import it
// at module load and the proxy / server components can import it too.

/** The guest cookie's name. Set by `GET /api/auth/guest`, cleared by a real sign-in. */
export const GUEST_COOKIE = "jj_guest";

/** The `user_id` every guest row carries. Never a real `auth.uid()` (those are UUIDs). */
export const GUEST_USER_ID = "guest";

/** The guest's own IndexedDB — a guest never opens (or writes) Javi's `"javis-journal"`. */
export const GUEST_DB_NAME = "javis-journal-guest";

/** The signed-in database, unchanged since M2. */
export const JOURNAL_DB_NAME = "javis-journal";

/**
 * How the server sets the guest cookie (decision 4): readable by the client (`httpOnly: false`,
 * since {@link isGuest} picks the database from it), `lax`, site-wide, for a year.
 */
export const GUEST_COOKIE_OPTIONS = {
  httpOnly: false,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
} as const;

/** How the server clears it: the same path, expired now. */
export const GUEST_COOKIE_CLEAR_OPTIONS = { path: "/", maxAge: 0 } as const;

/**
 * Client: is this browser in guest mode? Reads `jj_guest` from `document.cookie`, which is why
 * the cookie is not `httpOnly`. `false` on the server and in tests (no `document`) unless a test
 * stubs one; never throws.
 */
export function isGuest(): boolean {
  try {
    if (typeof document === "undefined") return false;
    return document.cookie
      .split(";")
      .some((pair) => pair.trim() === `${GUEST_COOKIE}=1`);
  } catch {
    return false;
  }
}

/**
 * Client: the IndexedDB name for this page load. Chosen ONCE, when `@/lib/db` evaluates, which is
 * why every switch between guest and signed-in is a full navigation (a server redirect or
 * `window.location.assign`), never a client-side route change.
 */
export function journalDbName(): string {
  return isGuest() ? GUEST_DB_NAME : JOURNAL_DB_NAME;
}

/**
 * Client: leave guest mode (decision 3). Expires the cookie and nothing else — the guest
 * database stays, so a later "Try it as a guest" in this browser finds it again. The caller
 * follows with a full navigation.
 */
export function clearGuestCookie(): void {
  if (typeof document === "undefined") return;
  document.cookie = `${GUEST_COOKIE}=; Max-Age=0; Path=/; SameSite=Lax`;
}

/** The slice of a cookie store both server gates hand in (`request.cookies`, `await cookies()`). */
export type CookieReader = {
  get(name: string): { value: string } | undefined;
};

/**
 * Server: does this request carry the guest cookie? The proxy and the home page both call this,
 * so the two gates cannot drift. It says nothing about precedence: a real Supabase user always
 * wins, and each gate checks for one first (decision 4).
 */
export function isGuestRequest(cookies: CookieReader): boolean {
  return cookies.get(GUEST_COOKIE)?.value === "1";
}
