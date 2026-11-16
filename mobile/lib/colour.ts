// Names the main colour(s) in an image. Pure logic, unit tested with Node.
//
// Every pixel is converted to hue / saturation / lightness and sorted into a
// named colour; the most common names win. Works on a small crop of the
// centre of the photo, so it describes what the camera is pointed at.

import type { ColourBase, ColourName, Shade } from './i18n.ts';

/** A second colour is mentioned only if it covers at least this share of the pixels. */
const SECOND_COLOUR_SHARE = 0.25;

function toHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
  else if (max === g) h = ((b - r) / d + 2) * 60;
  else h = ((r - g) / d + 4) * 60;
  return [h, s, l];
}

export function nameColour(r: number, g: number, b: number): ColourName {
  const [h, s, l] = toHsl(r, g, b);

  if (l < 0.12) return { base: 'black', shade: null };
  if (l > 0.9 && s < 0.5) return { base: 'white', shade: null };
  if (s < 0.15) {
    if (l > 0.75) return { base: 'white', shade: null };
    return { base: 'grey', shade: l < 0.35 ? 'dark' : l > 0.6 ? 'light' : null };
  }

  let base: ColourBase;
  if (h < 15 || h >= 345) base = 'red';
  else if (h < 45) base = l < 0.4 ? 'brown' : 'orange';
  else if (h < 68) base = l < 0.3 ? 'brown' : 'yellow';
  else if (h < 165) base = 'green';
  else if (h < 188) base = 'teal';
  else if (h < 255) base = 'blue';
  else if (h < 290) base = 'purple';
  else base = 'pink';

  // Low-saturation warm tones look brown rather than orange/red.
  if ((base === 'orange' || base === 'red') && s < 0.35 && l < 0.55) base = 'brown';

  const shade: Shade = base === 'brown' ? null : l < 0.3 ? 'dark' : l > 0.72 ? 'light' : null;
  return { base, shade };
}

const key = (c: ColourName) => `${c.shade ?? ''} ${c.base}`;

/** Most common colour in interleaved RGB pixels, plus a second one if it is common too. */
export function dominantColours(rgb: Uint8Array): { main: ColourName; second: ColourName | null } {
  const counts = new Map<string, { colour: ColourName; count: number }>();
  const pixels = Math.floor(rgb.length / 3);
  for (let p = 0; p < pixels; p++) {
    const colour = nameColour(rgb[p * 3], rgb[p * 3 + 1], rgb[p * 3 + 2]);
    const k = key(colour);
    const entry = counts.get(k);
    if (entry) entry.count++;
    else counts.set(k, { colour, count: 1 });
  }
  const ranked = [...counts.values()].sort((a, b) => b.count - a.count);
  if (ranked.length === 0) return { main: { base: 'black', shade: null }, second: null };

  const main = ranked[0].colour;
  // Ignore a "second colour" that is just a lighter/darker version of the main one.
  const other = ranked.slice(1).find(entry => entry.colour.base !== main.base);
  const second = other && other.count / pixels >= SECOND_COLOUR_SHARE ? other.colour : null;
  return { main, second };
}

/** Average brightness 0..255 (perceived luminance). */
export function meanLuminance(rgb: Uint8Array): number {
  const pixels = Math.floor(rgb.length / 3);
  if (pixels === 0) return 0;
  let sum = 0;
  for (let p = 0; p < pixels; p++) {
    sum += 0.2126 * rgb[p * 3] + 0.7152 * rgb[p * 3 + 1] + 0.0722 * rgb[p * 3 + 2];
  }
  return sum / pixels;
}
