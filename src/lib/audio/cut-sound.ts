"use client";

// US-14 — the cozy cutter's snip. One `playCut()` the Stamper fires at eject-start; everything
// else about the sound lives behind it. The invariants the M10 plan pins (decisions 4/5):
//   • it NEVER touches the cut/bake/placement path — every load/decode/play failure is swallowed;
//   • it is a no-op when muted — the in-app toggle is the deterministic guarantee (localStorage,
//     per-device: phone-in-pocket vs desktop speakers), default On;
//   • it is unlocked inside a real user gesture (the drawer press), so no autoplay block.
//
// The backing (a decoded WebAudio buffer here) is deliberately hidden behind `playCut()` so
// Tier-2 on Javi's actual iPhone can arbitrate WebAudio vs a plain HTMLAudioElement for silent-
// switch behavior without any caller changing — the in-app toggle is the guarantee regardless.

const CUT_SRC = "/stamper/cut.mp3";
const PREF_KEY = "javi.cutSound"; // stores "off" to disable; absent or anything else means On.

/** The mute pref. Default On — absent key, unreadable storage, all read as enabled. */
export function soundEnabled(): boolean {
  try {
    return globalThis.localStorage?.getItem(PREF_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Persist the mute pref. Per-device, not synced. A storage failure (private mode/quota) is
 *  swallowed — this runs off a menu tap and must never throw at the caller. */
export function setSoundEnabled(on: boolean): void {
  try {
    globalThis.localStorage?.setItem(PREF_KEY, on ? "on" : "off");
  } catch {
    // ignore
  }
}

let ctx: AudioContext | null = null;
let buffer: AudioBuffer | null = null;
let decoding: Promise<AudioBuffer | null> | null = null;

type AudioCtor = typeof AudioContext;

function audioContext(): AudioContext | null {
  if (ctx) return ctx;
  try {
    const g = globalThis as unknown as {
      AudioContext?: AudioCtor;
      webkitAudioContext?: AudioCtor;
    };
    const Ctor = g.AudioContext ?? g.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    return ctx;
  } catch {
    return null;
  }
}

/** Fetch + decode the snip once, then cache it. Concurrent calls share the in-flight promise. */
function loadBuffer(context: AudioContext): Promise<AudioBuffer | null> {
  if (buffer) return Promise.resolve(buffer);
  if (decoding) return decoding;
  decoding = (async () => {
    try {
      const res = await fetch(CUT_SRC);
      const arr = await res.arrayBuffer();
      buffer = await context.decodeAudioData(arr);
      return buffer;
    } catch {
      return null;
    } finally {
      decoding = null;
    }
  })();
  return decoding;
}

/**
 * Unlock + warm the audio inside a real user gesture (the drawer press). Resumes a suspended
 * context (Safari/iOS start suspended) and primes the decode cache while a gesture is live, so
 * the later `playCut()` — which fires after the async bake, no longer inside a gesture — is not
 * blocked by autoplay policy. All-swallowing; never throws.
 */
export function unlockAudio(): void {
  try {
    const context = audioContext();
    if (!context) return;
    if (context.state === "suspended") void context.resume();
    void loadBuffer(context);
  } catch {
    // swallow
  }
}

/**
 * Play the snip. Fire-and-forget (returns immediately — the eject beat never awaits it) and
 * fully swallowed: a no-op when muted, when there is no AudioContext, or on any load/decode/play
 * failure. Audio can never delay or fail the cut.
 */
export function playCut(): void {
  if (!soundEnabled()) return;
  void (async () => {
    try {
      const context = audioContext();
      if (!context) return;
      if (context.state === "suspended") await context.resume();
      const buf = await loadBuffer(context);
      if (!buf) return;
      const source = context.createBufferSource();
      source.buffer = buf;
      source.connect(context.destination);
      source.start();
    } catch {
      // swallow — audio never touches the cut/bake/placement path.
    }
  })();
}

/** Test-only: drop the cached context/buffer so each test starts clean. */
export function __resetCutSoundForTest(): void {
  ctx = null;
  buffer = null;
  decoding = null;
}
