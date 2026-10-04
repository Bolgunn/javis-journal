// Sync engine: owns the debounce timer, the push/pull backoff state machines, and
// the browser-lifecycle pull cadence. push.ts/pull.ts stay gesture- and timer-agnostic;
// all scheduling lives here (see M2-PLAN Task 5).

import { isGuest } from "@/lib/auth/identity";
import { evictOriginals } from "@/lib/image/eviction";
import { markDirty as outboxMarkDirty, type SyncOperation, type SyncTable } from "./outbox";
import { flush, PushNetworkError } from "./push";
import { pullAll } from "./pull";
import { setSyncStatus } from "./status";

const DEBOUNCE_MS = 800;
const BACKOFF_MIN_MS = 2_000;
const BACKOFF_MAX_MS = 60_000;
const PULL_INTERVAL_MS = 60_000;

function nextBackoff(current: number): number {
  return Math.min(current * 2, BACKOFF_MAX_MS);
}

// ---- Push side: 800ms debounce -> flush, with retry backoff on network failure ----

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let flushRetryTimer: ReturnType<typeof setTimeout> | null = null;
let flushBackoff = BACKOFF_MIN_MS;

/**
 * Optimistic dirty marker: records the change in the outbox and arms the 800ms idle
 * flush timer. Callers creating a new row must set `id: crypto.randomUUID()` first
 * (see the contract in outbox.ts).
 */
export async function markDirty(
  table: SyncTable,
  rowId: string,
  op: SyncOperation,
): Promise<void> {
  await outboxMarkDirty(table, rowId, op);
  scheduleFlush();
}

export function scheduleFlush(): void {
  if (debounceTimer) {
    clearTimeout(debounceTimer);
  }

  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    void flushNow();
  }, DEBOUNCE_MS);
}

/**
 * Flush pending outbox rows now. Exported for future gesture-end hooks (M6+, ALG-9) to
 * call directly with no gesture knowledge inside this module. Resets backoff on success;
 * on a network failure it schedules an exponential-backoff retry (outbox stays dirty).
 */
export async function flushNow(): Promise<void> {
  // M11 decision 5: a guest has no transport. The outbox still records every change (the write
  // path is Javi's, byte for byte); it is simply never drained — no push, no backoff timer.
  if (isGuest()) return;

  if (flushRetryTimer) {
    clearTimeout(flushRetryTimer);
    flushRetryTimer = null;
  }

  setSyncStatus("syncing");

  try {
    await flush();
    flushBackoff = BACKOFF_MIN_MS;
    setSyncStatus("idle");
    // A successful flush means any just-uploaded originals may now be evictable.
    void evictOriginals();
  } catch (error) {
    // A thrown error means a network/offline failure (row-level rejections are
    // quarantined inside flush() and never throw). Keep the outbox dirty and retry.
    setSyncStatus(error instanceof PushNetworkError ? "offline" : "error");

    const delay = flushBackoff;
    flushBackoff = nextBackoff(flushBackoff);
    flushRetryTimer = setTimeout(() => {
      flushRetryTimer = null;
      void flushNow();
    }, delay);
  }
}

// ---- Pull side: immediate + visibility/focus + 60s interval, with backoff ----

let pullRetryTimer: ReturnType<typeof setTimeout> | null = null;
let pullBackoff = BACKOFF_MIN_MS;

/**
 * Run one pull cycle now, with exponential backoff on failure. Exported for testing and
 * for callers that want to force a refresh.
 */
export async function pullNow(): Promise<void> {
  if (isGuest()) return; // M11: no transport for a guest (see flushNow)

  if (pullRetryTimer) {
    clearTimeout(pullRetryTimer);
    pullRetryTimer = null;
  }

  setSyncStatus("syncing");

  try {
    await pullAll();
    pullBackoff = BACKOFF_MIN_MS;
    setSyncStatus("idle");
  } catch {
    setSyncStatus("offline");

    const delay = pullBackoff;
    pullBackoff = nextBackoff(pullBackoff);
    pullRetryTimer = setTimeout(() => {
      pullRetryTimer = null;
      void pullNow();
    }, delay);
  }
}

/**
 * Start the pull loop: pull immediately, then on visibilitychange/focus and every 60s
 * while the document is visible. Returns a cleanup function that removes all listeners
 * and clears timers (called on unmount by SyncBoot).
 */
export function startSyncLoop(): () => void {
  // M11: a guest never pulls — no immediate pull, no listeners, no 60s interval.
  if (isGuest()) return () => {};

  void pullNow();
  // Evict any originals that aged past retention while the app was closed.
  void evictOriginals();

  const onWake = () => {
    if (document.visibilityState === "visible") {
      void pullNow();
    }
  };

  document.addEventListener("visibilitychange", onWake);
  window.addEventListener("focus", onWake);

  const intervalId = setInterval(() => {
    if (document.visibilityState === "visible") {
      void pullNow();
    }
  }, PULL_INTERVAL_MS);

  return () => {
    document.removeEventListener("visibilitychange", onWake);
    window.removeEventListener("focus", onWake);
    clearInterval(intervalId);

    if (pullRetryTimer) {
      clearTimeout(pullRetryTimer);
      pullRetryTimer = null;
    }

    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (flushRetryTimer) {
      clearTimeout(flushRetryTimer);
      flushRetryTimer = null;
    }
  };
}

// Test-only hook to reset module-level backoff/timer state between cases.
export function __resetEngineForTests(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  if (flushRetryTimer) clearTimeout(flushRetryTimer);
  if (pullRetryTimer) clearTimeout(pullRetryTimer);
  debounceTimer = null;
  flushRetryTimer = null;
  pullRetryTimer = null;
  flushBackoff = BACKOFF_MIN_MS;
  pullBackoff = BACKOFF_MIN_MS;
}

// Test-only view of current backoff delays (ms).
export function __getBackoffForTests(): { flush: number; pull: number } {
  return { flush: flushBackoff, pull: pullBackoff };
}
