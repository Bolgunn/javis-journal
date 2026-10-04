// Display helper (ALG-6): image_id -> 256px thumb URL. Local-blob-first, with a
// signed-URL fallback + lazy backfill and disciplined object-URL revocation.
// Framework-agnostic; M4 wraps it in a React hook.

import { db } from "@/lib/db";
import type { ImageBlobRow } from "@/lib/db/image-types";
import { isGuest } from "@/lib/auth/identity";
import { createClient } from "@/lib/supabase/browser";

export type ThumbHandle = {
  /** A URL usable as an <img> src. */
  url: string;
  /** Revokes the underlying object URL exactly once. No-op for signed URLs. */
  release: () => void;
};

const BUCKET = "images";
const SIGNED_TTL_MS = 24 * 60 * 60 * 1000; // re-mint the cached signed URL after 24h
const SIGNED_EXPIRES_SEC = 60 * 60 * 24; // request a 24h-valid signed URL
let liveUrlCap = 120; // bound live object URLs even on a caller that never releases

// Keyed by storage PATH (not image id): one image has two distinct objects — the closeup
// (storage_path) and the thumb (thumb_path) — so keying by id would let getCloseupUrl and
// getThumbUrl clobber each other's cached signed URL.
const signedCache = new Map<string, { url: string; expiresAt: number }>();

/** Backfill kind from the images.mime (webp -> baked stamp; png -> sticker; else photo). */
function inferKind(mime: string | undefined): ImageBlobRow["kind"] {
  if (mime === "image/webp") return "stamp";
  if (mime === "image/png") return "sticker";
  return "photo";
}

// Insertion-ordered registry of live object URLs for the LRU cap. Keyed by a
// unique token so identical URLs (unlikely) never collide.
const liveObjectUrls = new Map<string, string>();
let tokenSeq = 0;

function noop(): void {}

/**
 * Live object-URL count — the ALG-6 object-URL canary. In steady state this must
 * stay flat across month navigations (release-on-unmount brings each month's handles
 * back to baseline). Used by the /dev/calendar harness readout and the canary test.
 */
export function getLiveThumbUrlCount(): number {
  return liveObjectUrls.size;
}

function objectUrlHandle(blob: Blob): ThumbHandle {
  const url = URL.createObjectURL(blob);
  const token = `t${++tokenSeq}`;
  liveObjectUrls.set(token, url);
  enforceLruCap();

  let released = false;
  return {
    url,
    release() {
      if (released) return;
      released = true;
      if (liveObjectUrls.delete(token)) {
        URL.revokeObjectURL(url);
      }
    },
  };
}

function enforceLruCap(): void {
  while (liveObjectUrls.size > liveUrlCap) {
    const oldest = liveObjectUrls.keys().next().value as string | undefined;
    if (oldest === undefined) break;
    const url = liveObjectUrls.get(oldest);
    liveObjectUrls.delete(oldest);
    if (url) URL.revokeObjectURL(url);
  }
}

/**
 * Resolve one thumbnail. Returns a local object-URL handle when the thumb blob is
 * on-device; otherwise returns a signed URL (release is a no-op) and kicks off a
 * lazy backfill so the next call resolves locally. Returns null if the image is
 * unknown or cannot be resolved.
 */
export async function getThumbUrl(id: string): Promise<ThumbHandle | null> {
  const local = await db.image_blobs.get(id);
  if (local?.thumb) {
    return objectUrlHandle(local.thumb);
  }

  const imageRow = await db.images.get(id);
  if (!imageRow) return null;

  const signed = await getSignedUrl(imageRow.thumb_path);
  if (!signed) return null;

  void backfillThumb(id, signed);
  return { url: signed, release: noop };
}

/**
 * Resolve one 2048px closeup (day page — the baked stamp, or a photo's re-fit main).
 * Mirrors getThumbUrl: local `main` blob first; else sign `storage_path`, backfill locally,
 * cache 24h, return a released-on-revoke handle under the shared LRU cap.
 */
export async function getCloseupUrl(id: string): Promise<ThumbHandle | null> {
  const local = await db.image_blobs.get(id);
  if (local?.main) {
    return objectUrlHandle(local.main);
  }

  const imageRow = await db.images.get(id);
  if (!imageRow) return null;

  const signed = await getSignedUrl(imageRow.storage_path);
  if (!signed) return null;

  void backfillCloseup(id, signed);
  return { url: signed, release: noop };
}

/** Batch variant: one createSignedUrls round-trip for the remote misses. */
export async function getThumbUrls(ids: string[]): Promise<Map<string, ThumbHandle>> {
  const out = new Map<string, ThumbHandle>();

  const [localRows, imageRows] = await Promise.all([
    db.image_blobs.bulkGet(ids),
    db.images.bulkGet(ids),
  ]);

  const misses: { id: string; path: string }[] = [];

  ids.forEach((id, i) => {
    const thumb = localRows[i]?.thumb;
    if (thumb) {
      out.set(id, objectUrlHandle(thumb));
      return;
    }
    const path = imageRows[i]?.thumb_path;
    if (path) misses.push({ id, path });
  });

  if (misses.length > 0) {
    const signed = await getSignedUrls(misses);
    for (const { id } of misses) {
      const url = signed.get(id);
      if (!url) continue;
      void backfillThumb(id, url);
      out.set(id, { url, release: noop });
    }
  }

  return out;
}

/**
 * Batch variant of {@link getCloseupUrl} — the day page resolves all of a day's stamps in one
 * round-trip and releases every handle when the overlay closes (ALG-6; there is a canary test).
 */
export async function getCloseupUrls(ids: string[]): Promise<Map<string, ThumbHandle>> {
  const out = new Map<string, ThumbHandle>();

  const [localRows, imageRows] = await Promise.all([
    db.image_blobs.bulkGet(ids),
    db.images.bulkGet(ids),
  ]);

  const misses: { id: string; path: string }[] = [];

  ids.forEach((id, i) => {
    const main = localRows[i]?.main;
    if (main) {
      out.set(id, objectUrlHandle(main));
      return;
    }
    const path = imageRows[i]?.storage_path;
    if (path) misses.push({ id, path });
  });

  if (misses.length > 0) {
    const signed = await getSignedUrls(misses);
    for (const { id } of misses) {
      const url = signed.get(id);
      if (!url) continue;
      void backfillCloseup(id, url);
      out.set(id, { url, release: noop });
    }
  }

  return out;
}

async function getSignedUrl(path: string): Promise<string | null> {
  // M11: a guest's images exist only on this device; a local miss renders blank rather than
  // firing a Storage request that has no session behind it.
  if (isGuest()) return null;

  const cached = signedCache.get(path);
  if (cached && cached.expiresAt > Date.now()) return cached.url;

  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_EXPIRES_SEC);
  if (error || !data) return null;

  signedCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + SIGNED_TTL_MS });
  return data.signedUrl;
}

async function getSignedUrls(
  misses: { id: string; path: string }[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (isGuest()) return result; // M11: no remote fallback for a guest (see getSignedUrl)
  const now = Date.now();

  const uncached: { id: string; path: string }[] = [];
  for (const miss of misses) {
    const cached = signedCache.get(miss.path);
    if (cached && cached.expiresAt > now) {
      result.set(miss.id, cached.url);
    } else {
      uncached.push(miss);
    }
  }

  if (uncached.length === 0) return result;

  const supabase = createClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(
      uncached.map((m) => m.path),
      SIGNED_EXPIRES_SEC,
    );
  if (error || !data) return result;

  // createSignedUrls preserves input order.
  data.forEach((entry, i) => {
    const miss = uncached[i];
    if (!miss || entry.error || !entry.signedUrl) return;
    signedCache.set(miss.path, { url: entry.signedUrl, expiresAt: now + SIGNED_TTL_MS });
    result.set(miss.id, entry.signedUrl);
  });

  return result;
}

/**
 * Download a signed thumb and store it locally so steady-state renders are local
 * and offline-capable. Best-effort: failures are swallowed. Never clobbers a
 * main/original the cutter may have already downloaded.
 */
// ---- Test-only hooks (module state persists across cases in a file) ----

export function __resetThumbUrlCacheForTests(): void {
  signedCache.clear();
  for (const url of liveObjectUrls.values()) URL.revokeObjectURL(url);
  liveObjectUrls.clear();
  tokenSeq = 0;
  liveUrlCap = 120;
}

export function __setLiveUrlCapForTests(cap: number): void {
  liveUrlCap = cap;
  enforceLruCap();
}

async function backfillThumb(id: string, signedUrl: string): Promise<void> {
  try {
    const res = await fetch(signedUrl);
    if (!res.ok) return;
    const thumb = await res.blob();

    const existing = await db.image_blobs.get(id);
    if (existing) {
      if (!existing.thumb) await db.image_blobs.update(id, { thumb });
      return;
    }

    const imageRow = await db.images.get(id);
    await db.image_blobs.put({
      id,
      original: null,
      main: null,
      thumb,
      kind: inferKind(imageRow?.mime),
      createdAt: Date.now(),
    });
  } catch {
    // best-effort backfill; the signed URL already satisfied this render
  }
}

/**
 * Download a signed closeup and store it locally as `main`. Best-effort. Mirrors
 * backfillThumb; when there is no local blob row yet it creates one with `thumb: null`
 * (the grid's getThumbUrl backfill fills the thumb later). Never clobbers an existing main.
 */
async function backfillCloseup(id: string, signedUrl: string): Promise<void> {
  try {
    const existing = await db.image_blobs.get(id);
    if (existing?.main) return;

    const res = await fetch(signedUrl);
    if (!res.ok) return;
    const main = await res.blob();

    const fresh = await db.image_blobs.get(id);
    if (fresh) {
      if (!fresh.main) await db.image_blobs.update(id, { main });
      return;
    }

    const imageRow = await db.images.get(id);
    await db.image_blobs.put({
      id,
      original: null,
      main,
      thumb: null,
      kind: inferKind(imageRow?.mime),
      createdAt: Date.now(),
    });
  } catch {
    // best-effort backfill; the signed URL already satisfied this render
  }
}
