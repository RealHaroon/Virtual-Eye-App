// User settings, saved as a small JSON file on the phone.

import { useSyncExternalStore } from 'react';
import { File, Paths } from 'expo-file-system';
import type { Verbosity } from './announcer';

export type SpeechSpeed = 'slow' | 'normal' | 'fast';

export type Settings = {
  speechSpeed: SpeechSpeed;
  verbosity: Verbosity;
};

export const DEFAULT_SETTINGS: Settings = { speechSpeed: 'normal', verbosity: 'normal' };

/** expo-speech rate for normal messages; warnings are spoken a little faster. */
export const SPEECH_RATES: Record<SpeechSpeed, number> = { slow: 0.45, normal: 0.55, fast: 0.75 };

const SPEEDS: SpeechSpeed[] = ['slow', 'normal', 'fast'];
const VERBOSITIES: Verbosity[] = ['quiet', 'normal', 'detailed'];

const file = new File(Paths.document, 'settings.json');
const listeners = new Set<() => void>();
let current: Settings = load();

function load(): Settings {
  try {
    if (!file.exists) return DEFAULT_SETTINGS;
    const saved = JSON.parse(file.textSync());
    return {
      speechSpeed: SPEEDS.includes(saved.speechSpeed) ? saved.speechSpeed : DEFAULT_SETTINGS.speechSpeed,
      verbosity: VERBOSITIES.includes(saved.verbosity) ? saved.verbosity : DEFAULT_SETTINGS.verbosity,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function getSettings(): Settings {
  return current;
}

export function updateSettings(changes: Partial<Settings>) {
  current = { ...current, ...changes };
  try {
    file.write(JSON.stringify(current));
  } catch {
    // Not saved; the change still applies until the app restarts.
  }
  listeners.forEach(listener => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Current settings; re-renders when they change. */
export function useSettings(): Settings {
  return useSyncExternalStore(subscribe, getSettings);
}
