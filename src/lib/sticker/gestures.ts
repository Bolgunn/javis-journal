// The sticker layer's gesture machine — the SAME machine the day page uses (M7 decision 4),
// injected with the sticker surface: the 28/15 day-grid bbox and the clamps that keep a sticker
// inside it. Nothing about the interaction differs, and that is the point: long-press to select,
// drag / pinch / twist, 45° on release, one write per gesture.

import { topElementAt } from "@/lib/gestures/hit";
import { TransformGestures, type GestureCallbacks, type Surface } from "@/lib/gestures/machine";
import type { StickerBox } from "./layout";
import { GRID_ASPECT, clampCenter, clampScale, snapRotation } from "./place";

export {
  LONG_PRESS_MS,
  ROTATE_STEP_DEG,
  SCALE_STEP,
  SLOP_PX,
  WHEEL_COMMIT_MS,
  type LiveTransform,
} from "@/lib/gestures/machine";

/** The day-grid bbox: a 28/15 box (GRID_ASPECT), with a sticker clamped fully inside it at every rotation. */
const STICKER_SURFACE: Surface<StickerBox> = {
  aspect: GRID_ASPECT,
  clampScale: (scale, aspect, rotationDeg) => clampScale(scale, aspect, rotationDeg),
  clampCenter: (pos, scale, aspect, rotationDeg) =>
    clampCenter(pos, scale, aspect, rotationDeg),
  snapRotation: (deg) => snapRotation(deg),
  topAt: (p, boxes) => topElementAt(p, boxes),
};

/** One instance per mounted month's sticker layer. */
export class StickerGestures extends TransformGestures<StickerBox> {
  constructor(cb: GestureCallbacks) {
    super(cb, STICKER_SURFACE);
  }
}
