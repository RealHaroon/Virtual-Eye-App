// Optional server mode: sends a photo to the FastAPI backend (server/main.py).

import type { DetectedObject } from './announcer';

// Set EXPO_PUBLIC_BACKEND_URL in mobile/.env.local (see .env.example) to use the
// server (bigger model, EasyOCR). Unset = everything runs on the phone.
export const BACKEND_URL = process.env.EXPO_PUBLIC_BACKEND_URL || null;
const REQUEST_TIMEOUT_MS = 5000;

export type ServerResult = {
  text: string;
  warning: boolean;
  // Sent by newer servers; older ones only send text/warning.
  objects?: DetectedObject[];
  ocr?: string | null;
};

/** Sends one photo to the server. Throws on timeout or a non-2xx response. */
export async function detectOnServer(photoUri: string): Promise<ServerResult> {
  if (!BACKEND_URL) throw new Error('No server configured');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const formData = new FormData();
    formData.append('file', { uri: photoUri, type: 'image/jpeg', name: 'frame.jpg' } as any);
    const res = await fetch(`${BACKEND_URL}/detect`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}
