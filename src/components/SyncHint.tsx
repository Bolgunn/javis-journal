"use client";

// The calm "offline — will sync" reassurance (ALG-3, M10 decision 7). The app is local-first:
// every edit is saved on-device instantly and the engine retries the push with backoff, so a
// dropped connection is a non-event — but she should still be *told*, gently, that her work is
// safe and simply waiting. This is the one place the M2 sync-status observable reaches the UI.
//
// It shows ONLY while not synced (offline/error) and says nothing the rest of the time — no
// "saved ✓" flash on every keystroke (that would fight her). A soft pill, pointer-transparent,
// out of the way at the bottom.

import { useEffect, useState } from "react";

import { getSyncStatus, subscribeSyncStatus, type SyncStatus } from "@/lib/sync/status";

function useSyncStatus(): SyncStatus {
  const [status, setStatus] = useState<SyncStatus>(() => getSyncStatus());
  useEffect(() => subscribeSyncStatus(setStatus), []);
  return status;
}

export function SyncHint() {
  const status = useSyncStatus();
  const waiting = status === "offline" || status === "error";
  if (!waiting) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center">
      <span className="rounded-full border border-line bg-paper/95 px-3 py-1.5 text-xs font-semibold text-muted shadow-sm backdrop-blur">
        Offline — your changes are saved and will sync
      </span>
    </div>
  );
}
