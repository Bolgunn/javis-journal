// Seed the 3 personal stickers into her tray on first boot (US-9, M7 decision 10).
//
// **Idempotency across devices is the whole trick.** The ids are DETERMINISTIC —
// `uuid(SHA-256(user_id + ':' + key))` for both the `images` row and the `sticker_assets` row —
// so a second device that seeds the same sticker writes the *same primary keys*: an upsert, not
// a duplicate. (A `stickers_seeded` flag on `profiles` was rejected: a new column that still
// races on a fresh second device.) The hash is per-user, so ids never collide between her
// account and the owner-override account.
//
// Seeding **never blocks the calendar**: offline, a missing file, or a decode failure just
// no-ops that sticker, and the next mount retries it.

import { isGuest } from "@/lib/auth/identity";
import { db } from "@/lib/db";
import { addTrayAsset } from "@/lib/db/mutations";
import { ingestImage } from "@/lib/image/ingest";
import { STICKER_SEEDS, type StickerSeed } from "./seeds";

/** One run per page load, even if two mounts race (React strict mode, a remount). */
let inFlight: Promise<void> | null = null;

/**
 * Ensure the seeded stickers are in the tray. Safe to call on every Calendar mount: a sticker
 * already seeded here (or already pulled from another device) costs one indexed lookup.
 */
export function seedStickers(userId: string): Promise<void> {
  // M11 decision 6: a guest's tray starts empty — Javi's sticker art never enters the demo.
  if (isGuest()) return Promise.resolve();
  if (!inFlight) {
    inFlight = run(userId).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

async function run(userId: string): Promise<void> {
  for (const seed of STICKER_SEEDS) {
    try {
      await seedOne(userId, seed);
    } catch {
      // Best-effort by design: a failed seed is retried on the next mount, and never keeps her
      // out of her own calendar.
    }
  }
}

async function seedOne(userId: string, seed: StickerSeed): Promise<void> {
  const assetId = await deterministicId(userId, `sticker_asset:${seed.slug}`);
  if (await db.sticker_assets.get(assetId)) return; // already seeded, here or on another device

  const imageId = await deterministicId(userId, `image:${seed.slug}`);
  if (!(await db.images.get(imageId))) {
    const res = await fetch(seed.path);
    if (!res.ok) throw new Error(`Seed sticker ${seed.slug} is not fetchable.`);
    const blob = await res.blob();
    const file = new File([blob], `${seed.slug}.png`, { type: "image/png" });
    // The same pipeline every uploaded sticker takes — PNG alpha and all.
    await ingestImage(file, "sticker", { id: imageId });
  }

  await addTrayAsset(imageId, { id: assetId, isSeeded: true });
}

/**
 * `uuid(SHA-256(userId + ':' + key))` — a stable UUID for a (user, thing) pair. Formatted as a
 * v4-shaped uuid because Postgres stores these columns as `uuid`; the version/variant bits are
 * cosmetic here, the determinism is the point.
 */
export async function deterministicId(userId: string, key: string): Promise<string> {
  const data = new TextEncoder().encode(`${userId}:${key}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
