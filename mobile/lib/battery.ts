// Battery saver: notices when the phone lies face down (e.g. on a table) so
// scanning can pause. Pure logic, unit tested with Node.

/** How long (ms) the phone must stay face down before scanning pauses. */
export const FACE_DOWN_PAUSE_MS = 2000;

export type Platform = 'android' | 'ios' | string;

/**
 * Accelerometer z axis in g. Lying flat face up, Android reports about +1 and
 * iOS about -1, so face down is the opposite. Thresholds with a gap between
 * them (hysteresis) stop the state flickering while the phone is tilted.
 */
export function faceDownState(z: number, platform: Platform, wasFaceDown: boolean): boolean {
  const down = platform === 'ios' ? z : -z; // > 0 means screen facing the floor
  return wasFaceDown ? down > 0.6 : down > 0.85;
}

/** Tracks face-down time and says when to pause or resume. */
export function createFaceDownTracker(platform: Platform) {
  let faceDown = false;
  let since = 0;
  let paused = false;
  return {
    /** Feed each accelerometer reading; returns 'pause', 'resume' or null. */
    update(z: number, now: number): 'pause' | 'resume' | null {
      const next = faceDownState(z, platform, faceDown);
      if (next && !faceDown) since = now;
      faceDown = next;
      if (faceDown && !paused && now - since >= FACE_DOWN_PAUSE_MS) {
        paused = true;
        return 'pause';
      }
      if (!faceDown && paused) {
        paused = false;
        return 'resume';
      }
      return null;
    },
  };
}
