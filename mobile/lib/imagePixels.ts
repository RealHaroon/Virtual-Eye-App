// Turns a photo into raw RGB pixels: optional crop, resize, then JPEG decode.

import { manipulateAsync, SaveFormat, type Action } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import * as jpeg from 'jpeg-js';

export type Crop = { originX: number; originY: number; width: number; height: number };

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Interleaved RGB bytes (r,g,b,r,g,b,...) of the photo, cropped (optional) and
 * resized to exactly width x height. Giving both sizes stretches the image.
 */
export async function loadRgb(photoUri: string, width: number, height: number, crop?: Crop): Promise<Uint8Array> {
  const actions: Action[] = crop ? [{ crop }] : [];
  actions.push({ resize: { width, height } });
  const result = await manipulateAsync(photoUri, actions, {
    format: SaveFormat.JPEG, compress: 0.9, base64: true,
  });
  try {
    if (!result.base64) throw new Error('Image resize returned no data');
    return jpeg.decode(base64ToBytes(result.base64), { useTArray: true, formatAsRGBA: false }).data;
  } finally {
    try {
      new File(result.uri).delete();
    } catch {
      // cache file already gone
    }
  }
}

/** The middle `fraction` of the photo (what the camera is pointed at). */
export function centreCrop(photoWidth: number, photoHeight: number, fraction = 0.3): Crop {
  const size = Math.round(Math.min(photoWidth, photoHeight) * fraction);
  return {
    originX: Math.round((photoWidth - size) / 2),
    originY: Math.round((photoHeight - size) / 2),
    width: size,
    height: size,
  };
}
