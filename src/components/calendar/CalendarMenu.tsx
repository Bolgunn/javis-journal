"use client";

import { useState } from "react";

import { setSoundEnabled, soundEnabled } from "@/lib/audio/cut-sound";
import type { SelectedFrame } from "@/lib/db/types";
import { FRAMES, FRAME_IDS } from "@/lib/frames/spec";
import { frameCss } from "@/lib/frames/style";
import { createClient } from "@/lib/supabase/browser";

/**
 * The 3-dots menu (US-2/US-3/US-4/US-10/US-12). Live items:
 *   • Toggle full-month view   • Change month   • Download PNG
 *   • Frame: 3 swatches (re-tap the worn one to go bare)    • Logout
 * A frame change keeps the menu open so the change is visible behind it; the other actions
 * (including Download PNG, which opens the export sheet) close it.
 */
export function CalendarMenu({
  open,
  onClose,
  onToggleView,
  onChangeMonth,
  onDownload,
  selectedFrame,
  onSetFrame,
}: {
  open: boolean;
  onClose: () => void;
  onToggleView: () => void;
  onChangeMonth: () => void;
  onDownload: () => void;
  selectedFrame: SelectedFrame;
  onSetFrame: (frame: SelectedFrame) => void;
}) {
  const [signingOut, setSigningOut] = useState(false);
  // The cut-sound pref is per-device (localStorage, not synced). Read lazily on the client — the
  // menu only ever renders behind a user tap, so there is no SSR/hydration read.
  const [soundOn, setSoundOn] = useState(() => soundEnabled());

  if (!open) return null;

  async function handleLogout() {
    setSigningOut(true);
    try {
      await createClient().auth.signOut();
    } finally {
      // Full reload clears client state; the proxy sends the signed-out user to login.
      window.location.assign("/login");
    }
  }

  return (
    <div className="fixed inset-0 z-30" onClick={onClose}>
      <div
        className="absolute right-4 top-16 w-56 overflow-hidden rounded-card border border-line bg-paper shadow-[0_18px_48px_rgba(88,74,58,0.18)]"
        role="menu"
        aria-label="Calendar menu"
        onClick={(e) => e.stopPropagation()}
      >
        <MenuButton
          onClick={() => {
            onToggleView();
            onClose();
          }}
        >
          Toggle full-month view
        </MenuButton>

        <Divider />

        <MenuButton
          onClick={() => {
            onChangeMonth();
            onClose();
          }}
        >
          Change month
        </MenuButton>

        <Divider />

        <MenuButton
          onClick={() => {
            onDownload();
            onClose();
          }}
        >
          Download PNG
        </MenuButton>

        <Divider />

        {/* US-10. Each swatch WEARS its own frame at ×1 — the preview is the real asset through
            the real CSS path, so there is nothing to keep in sync with the calendar. Tapping
            keeps the menu open: the month re-frames behind it and she sees it land.

            Bare has no swatch of its own: it is reached by re-tapping the frame she is already
            WEARING, which takes it off. Nothing is ever trapped — one tap in, one tap out. */}
        <div className="px-4 py-3">
          <span className="text-sm font-semibold text-ink">Frame</span>
          <div
            className="mt-2 flex justify-between gap-2"
            role="radiogroup"
            aria-label="Calendar frame"
          >
            {FRAME_IDS.map((id) => (
              <FrameSwatch
                key={id}
                label={FRAMES[id].label}
                selected={selectedFrame === id}
                // The re-tap: wearing it already means she wants it off.
                onClick={() => onSetFrame(selectedFrame === id ? "none" : id)}
                style={frameCss(id, 1)}
              />
            ))}
          </div>
        </div>

        <Divider />

        {/* The cut sound's deterministic control (US-14, decision 5): the in-app guarantee, since
            the web can't read the iOS silent switch. Per-device, so it stays open on toggle — she
            flips it and stays put, no menu re-open. */}
        <MenuButton
          onClick={() => {
            const next = !soundOn;
            setSoundEnabled(next);
            setSoundOn(next);
          }}
        >
          <span className="flex items-center justify-between">
            Cut sound
            <span className={soundOn ? "text-ink" : "text-muted"}>{soundOn ? "On" : "Off"}</span>
          </span>
        </MenuButton>

        <Divider />

        <MenuButton onClick={handleLogout} disabled={signingOut}>
          {signingOut ? "Logging out…" : "Logout"}
        </MenuButton>
      </div>
    </div>
  );
}

/**
 * One frame choice. `size-10`: three swatches plus their gaps sit well inside the content width
 * the `w-56` menu's `px-4` leaves, and the button's own `p-1` keeps the touch target honest.
 */
function FrameSwatch({
  label,
  selected,
  onClick,
  style,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
  style?: React.CSSProperties;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      onClick={onClick}
      className={`flex flex-col items-center gap-1 rounded-control p-1 transition-colors ${
        selected ? "bg-accent-soft" : "hover:bg-accent-soft"
      }`}
    >
      <span className="block size-10 bg-paper" style={style} aria-hidden />
      <span
        className={`text-[10px] font-bold ${selected ? "text-ink" : "text-muted"}`}
      >
        {label}
      </span>
    </button>
  );
}

function MenuButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className="block w-full px-4 py-3 text-left text-sm font-semibold text-ink transition-colors hover:not-disabled:bg-accent-soft disabled:opacity-60"
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="h-px bg-line" aria-hidden />;
}
