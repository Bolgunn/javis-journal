/**
 * M11 — "Try it as a guest" (M11-PLAN decision 4), the secondary action on `/login` and `/denied`.
 *
 * A plain link, not `next/link`: `GET /api/auth/guest` sets the cookie and redirects home, and the
 * guest database is chosen at page load — so entering guest mode must be a full navigation.
 */
export function GuestButton() {
  return (
    <div className="flex flex-col items-center gap-2">
      <a
        href="/api/auth/guest"
        className="flex min-h-12 w-full items-center justify-center rounded-card border border-[#425f58] bg-paper font-semibold text-[#425f58] transition-colors hover:bg-accent-soft"
      >
        Try it as a guest
      </a>
      <p className="text-center text-[0.85rem] leading-snug text-muted">
        No account needed. Everything stays on this device.
      </p>
    </div>
  );
}
