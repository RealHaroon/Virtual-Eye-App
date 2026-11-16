// How bright is it? Pure logic, unit tested with Node.

import type { LightLevel } from './i18n.ts';

/**
 * From the light sensor (lux) when available: it measures real brightness.
 * Otherwise from the camera image (0..255), which is less reliable because the
 * camera adjusts its exposure, so its thresholds are rougher.
 */
export function lightLevel(lux: number | null, imageLuminance: number | null): LightLevel {
  if (lux !== null) {
    if (lux < 5) return 'veryDark';
    if (lux < 50) return 'dim';
    if (lux < 1000) return 'indoor';
    if (lux < 10000) return 'bright';
    return 'veryBright';
  }
  const y = imageLuminance ?? 0;
  if (y < 25) return 'veryDark';
  if (y < 70) return 'dim';
  if (y < 170) return 'indoor';
  return 'bright';
}
