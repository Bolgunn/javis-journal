// The day page's gesture machine (ALG-9 — direct manipulation, no menu).
//
// Since M7 this is a THIN INJECTION: the state machine itself lives in
// `src/lib/gestures/machine.ts` and is shared with the calendar's sticker layer, so the
// long-press gate, the 8px slop, the 45° snap-on-release, the wheel-debounce commit, the
// desktop accelerators, and the one-write-per-gesture rule exist in exactly one place. All this
// file supplies is the DAY SURFACE: the 8:5 page and the clamps that keep a stamp inside it.
//
// The public API is deliberately unchanged (same class name, same methods, same callbacks) —
// M6's suite is the acceptance test for the extraction.

import { hitsBox, topElementAt } from "./hit";
import type { StampBox } from "./layout";
import {
  PAGE_ASPECT,
  clampCenter,
  clampScale,
  snapRotation,
  type Point,
} from "./place";
import { TransformGestures, type Surface } from "@/lib/gestures/machine";

export {
  LONG_PRESS_MS,
  ROTATE_STEP_DEG,
  SCALE_STEP,
  SLOP_PX,
  WHEEL_COMMIT_MS,
  type GestureCallbacks,
  type LiveTransform,
} from "@/lib/gestures/machine";

import type { GestureCallbacks } from "@/lib/gestures/machine";

/** The day page: an 8:5 box, with a stamp clamped inside it at every rotation. */
const DAY_SURFACE: Surface<StampBox> = {
  aspect: PAGE_ASPECT,
  clampScale: (scale, aspect, rotationDeg) => clampScale(scale, aspect, rotationDeg),
  clampCenter: (pos, scale, aspect, rotationDeg) =>
    clampCenter(pos, scale, aspect, rotationDeg),
  snapRotation: (deg) => snapRotation(deg),
  topAt: (p, boxes) => topElementAt(p, boxes),
};

/** One instance per open day page. */
export class DayGestures extends TransformGestures<StampBox> {
  constructor(cb: GestureCallbacks) {
    super(cb, DAY_SURFACE);
  }

  /** Exposed for the harness/tests: does this point land on this box? */
  static hits(p: Point, box: StampBox): boolean {
    return hitsBox(p, box);
  }
}
