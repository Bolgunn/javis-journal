import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetCutSoundForTest,
  playCut,
  setSoundEnabled,
  soundEnabled,
  unlockAudio,
} from "./cut-sound";

/** A minimal AudioContext that records how it was driven, so we can assert playCut wiring. */
function installMockAudio(overrides: { decodeThrows?: boolean } = {}) {
  const start = vi.fn();
  const connect = vi.fn();
  const source = { buffer: null as unknown, connect, start };
  const ctor = vi.fn(function (this: Record<string, unknown>) {
    this.state = "suspended";
    this.destination = {};
    this.resume = vi.fn(async () => {
      (this as { state: string }).state = "running";
    });
    this.decodeAudioData = vi.fn(async () =>
      overrides.decodeThrows ? Promise.reject(new Error("bad")) : ({} as AudioBuffer),
    );
    this.createBufferSource = vi.fn(() => source);
  });
  (globalThis as unknown as { AudioContext: unknown }).AudioContext = ctor;
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as Response),
  );
  return { ctor, start, connect };
}

/** A tiny in-memory localStorage — the node test env has none, and we won't add jsdom. */
function installMockStorage() {
  const map = new Map<string, string>();
  const store: Pick<Storage, "getItem" | "setItem" | "removeItem" | "clear"> = {
    getItem: (k) => (map.has(k) ? (map.get(k) as string) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
  };
  vi.stubGlobal("localStorage", store);
}

beforeEach(() => {
  installMockStorage();
  __resetCutSoundForTest();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
});

describe("mute pref", () => {
  it("defaults to on when unset", () => {
    expect(soundEnabled()).toBe(true);
  });

  it("round-trips off then on", () => {
    setSoundEnabled(false);
    expect(soundEnabled()).toBe(false);
    setSoundEnabled(true);
    expect(soundEnabled()).toBe(true);
  });
});

describe("playCut", () => {
  it("is a no-op when muted — never constructs an AudioContext", async () => {
    const { ctor } = installMockAudio();
    setSoundEnabled(false);
    playCut();
    await Promise.resolve();
    expect(ctor).not.toHaveBeenCalled();
  });

  it("plays the buffer when enabled", async () => {
    const { start } = installMockAudio();
    setSoundEnabled(true);
    playCut();
    // let the fire-and-forget async chain settle
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(1));
  });

  it("never throws when there is no AudioContext", () => {
    delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    setSoundEnabled(true);
    expect(() => playCut()).not.toThrow();
  });

  it("never throws when decode fails", async () => {
    installMockAudio({ decodeThrows: true });
    setSoundEnabled(true);
    expect(() => playCut()).not.toThrow();
    await Promise.resolve();
  });
});

describe("unlockAudio", () => {
  it("resumes a suspended context and never throws", () => {
    installMockAudio();
    expect(() => unlockAudio()).not.toThrow();
  });

  it("never throws with no AudioContext", () => {
    delete (globalThis as unknown as { AudioContext?: unknown }).AudioContext;
    expect(() => unlockAudio()).not.toThrow();
  });
});
