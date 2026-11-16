// Text-to-speech in the user's chosen language and speed.

import * as Speech from 'expo-speech';
import { SPEECH_LANGUAGE_CODES, type Language } from './i18n';
import { getSettings, SPEECH_RATES } from './settings';

/**
 * Speaks `text` (stopping anything already being said) and resolves when it
 * finishes or is interrupted. Urgent messages are a little faster and lower.
 */
export function speak(text: string, { urgent = false } = {}): Promise<void> {
  const { speechSpeed, language } = getSettings();
  return new Promise((resolve) => {
    Speech.stop();
    Speech.speak(text, {
      language: SPEECH_LANGUAGE_CODES[language],
      rate: SPEECH_RATES[speechSpeed] + (urgent ? 0.1 : 0),
      pitch: urgent ? 0.95 : 1.0,
      volume: 1.0,
      onDone: () => resolve(),
      onError: () => resolve(),
      onStopped: () => resolve(),
    });
  });
}

export function stopSpeaking() {
  Speech.stop();
}

/** Whether the phone has a text-to-speech voice for this language. */
export async function hasVoiceFor(language: Language): Promise<boolean> {
  try {
    const prefix = SPEECH_LANGUAGE_CODES[language].slice(0, 2).toLowerCase();
    const voices = await Speech.getAvailableVoicesAsync();
    return voices.some(voice => voice.language?.toLowerCase().startsWith(prefix));
  } catch {
    return true; // can't tell; let the phone try
  }
}
