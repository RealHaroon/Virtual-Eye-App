// Reads text on the phone with Google ML Kit (Android) / Apple Vision (iOS).

import { extractTextFromImage, isSupported } from 'expo-text-extractor';
import { cleanOcrLines } from './ocrText';

/** Text worth reading aloud from the photo, or null (none found, or OCR unavailable). */
export async function readTextOnDevice(photoUri: string): Promise<string | null> {
  if (!isSupported) return null;
  try {
    return cleanOcrLines(await extractTextFromImage(photoUri));
  } catch {
    // e.g. the ML Kit model is still downloading on first use
    return null;
  }
}
