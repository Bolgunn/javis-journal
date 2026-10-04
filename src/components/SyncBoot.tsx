"use client";

import { useEffect } from "react";

import { isGuest } from "@/lib/auth/identity";
import { guestProfileBootstrap } from "@/lib/auth/guest-bootstrap";
import { startSyncLoop } from "@/lib/sync/engine";

/**
 * Mounts the local-first sync loop for a signed-in session. Renders nothing.
 * The engine resolves the current user fresh each cycle, so this can mount
 * unconditionally in the root layout — it no-ops (offline/backoff) when signed out.
 *
 * M11: a guest never syncs (belt and braces with the engine's own guard). Instead it writes the
 * guest's profile row — the one Javi's first pull would have brought — if there isn't one yet.
 */
export default function SyncBoot() {
  useEffect(() => {
    if (isGuest()) {
      void guestProfileBootstrap();
      return;
    }
    const stop = startSyncLoop();
    return stop;
  }, []);

  return null;
}
