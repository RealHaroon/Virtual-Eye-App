// Classifies a finished touch on the camera screen. Pure logic, unit tested with Node.

/** Horizontal distance (px) a finger must travel to count as a swipe. */
export const SWIPE_MIN_DISTANCE = 60;
/** Finger movement (px) beyond which a touch is no longer a tap or long-press. */
export const TAP_MAX_MOVEMENT = 15;
/** How long (ms) a finger must stay down for a long-press. */
export const LONG_PRESS_MS = 600;
/** Two taps within this time (ms) count as a double-tap. */
export const DOUBLE_TAP_MS = 300;

export type TouchKind = 'tap' | 'swipeLeft' | 'swipeRight' | 'none';

/** dx/dy: total finger movement in px (positive = right / down). */
export function classifyTouch(dx: number, dy: number): TouchKind {
  if (Math.abs(dx) >= SWIPE_MIN_DISTANCE && Math.abs(dx) > 1.5 * Math.abs(dy)) {
    return dx < 0 ? 'swipeLeft' : 'swipeRight';
  }
  if (Math.hypot(dx, dy) <= TAP_MAX_MOVEMENT) return 'tap';
  return 'none'; // vertical swipe or a wobble: ignore
}

/** Next mode in a list after a swipe (wraps around). Swipe left = next, right = previous. */
export function cycle<T>(items: readonly T[], current: T, direction: 'swipeLeft' | 'swipeRight'): T {
  const i = items.indexOf(current);
  const step = direction === 'swipeLeft' ? 1 : -1;
  return items[(i + step + items.length) % items.length];
}
