// M11 decision 5 — the guest's profile row. For Javi that row only ever arrives from the first
// pull, which a guest never runs; without it `useProfile().userId` stays null forever (no tray
// seeding gate, no frame/week-start fallback). So a guest boot writes one straight to Dexie.
//
// Kept apart from `identity.ts` on purpose: `@/lib/db` imports the identity seam at module load,
// so the seam itself must not import `@/lib/db` back.

import { db } from "@/lib/db";
import type { Profile } from "@/lib/db/types";
import { DEFAULT_FRAME } from "@/lib/frames/spec";
import { GUEST_USER_ID } from "./identity";

/**
 * Write the guest profile **only if no profile row exists** — never an overwrite, so a returning
 * guest keeps their frame and week start. Resolves `true` when it wrote. Not marked dirty: a
 * guest's outbox is never drained, and the row needs nothing from sync.
 */
export async function guestProfileBootstrap(): Promise<boolean> {
  return db.transaction("rw", db.profiles, async () => {
    if ((await db.profiles.count()) > 0) return false;

    const now = new Date().toISOString();
    const row: Profile = {
      user_id: GUEST_USER_ID,
      start_of_week: 1,
      selected_frame: DEFAULT_FRAME,
      fireworks_seen: false,
      created_at: now,
      updated_at: now,
    };
    await db.profiles.add(row);
    return true;
  });
}
