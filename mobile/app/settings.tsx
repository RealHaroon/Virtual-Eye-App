import { useState } from 'react';
import { useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Verbosity } from '../lib/announcer';
import { msg, msgWith, TUTORIAL, type Language } from '../lib/i18n';
import { updateSettings, useSettings, type SpeechSpeed } from '../lib/settings';
import { hasVoiceFor, speak } from '../lib/speech';

type Option<T extends string> = { value: T; label: string; description: string };

const SPEED_OPTIONS: Option<SpeechSpeed>[] = [
  { value: 'slow', label: 'Slow', description: 'Easier to follow' },
  { value: 'normal', label: 'Normal', description: 'Default' },
  { value: 'fast', label: 'Fast', description: 'For experienced listeners' },
];

const VERBOSITY_OPTIONS: Option<Verbosity>[] = [
  { value: 'quiet', label: 'Quiet', description: 'Only nearby objects, warnings and text' },
  { value: 'normal', label: 'Normal', description: 'New objects and anything getting closer' },
  { value: 'detailed', label: 'Detailed', description: 'More objects, more often' },
];

const LANGUAGE_OPTIONS: Option<Language>[] = [
  { value: 'en', label: 'English', description: 'English voice' },
  { value: 'ur', label: 'اردو  (Urdu)', description: 'Needs an Urdu text-to-speech voice on the phone' },
];

const NO_URDU_VOICE =
  'Urdu voice is not installed on this phone. Open phone Settings, then Text-to-speech, ' +
  'then Google, and install Urdu voice data.';

function OptionGroup<T extends string>({ title, options, selected, onSelect }: {
  title: string;
  options: Option<T>[];
  selected: T;
  onSelect: (value: T) => void;
}) {
  return (
    <View style={styles.group} accessibilityRole="radiogroup" accessibilityLabel={title}>
      <Text style={styles.groupTitle} accessibilityRole="header">{title}</Text>
      {options.map(option => {
        const isSelected = option.value === selected;
        return (
          <TouchableOpacity
            key={option.value}
            style={[styles.option, isSelected && styles.optionSelected]}
            onPress={() => onSelect(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ checked: isSelected }}
            accessibilityLabel={`${option.label}. ${option.description}`}
          >
            <View style={[styles.radio, isSelected && styles.radioSelected]} />
            <View style={styles.optionText}>
              <Text style={styles.optionLabel}>{option.label}</Text>
              <Text style={styles.optionDescription}>{option.description}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const settings = useSettings();
  const [urduVoiceMissing, setUrduVoiceMissing] = useState(false);

  const chooseLanguage = async (language: Language) => {
    updateSettings({ language });
    if (language === 'ur' && !(await hasVoiceFor('ur'))) {
      setUrduVoiceMissing(true);
      // Said in English on purpose: without an Urdu voice, Urdu text can't be spoken.
      updateSettings({ language: 'en' });
      await speak(NO_URDU_VOICE);
      updateSettings({ language: 'ur' });
      return;
    }
    setUrduVoiceMissing(false);
    speak(msg('languageChanged', language));
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title} accessibilityRole="header">Settings</Text>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.doneBtn}
          accessibilityRole="button"
          accessibilityLabel="Done, back to camera"
        >
          <Text style={styles.doneText}>Done</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <OptionGroup
          title="Speech speed"
          options={SPEED_OPTIONS}
          selected={settings.speechSpeed}
          onSelect={speechSpeed => {
            updateSettings({ speechSpeed });
            speak(msgWith('speechSpeed', speechSpeed, settings.language));
          }}
        />

        <OptionGroup
          title="How much to say"
          options={VERBOSITY_OPTIONS}
          selected={settings.verbosity}
          onSelect={verbosity => {
            updateSettings({ verbosity });
            speak(msgWith('verbosity', verbosity, settings.language));
          }}
        />

        <OptionGroup
          title="Language"
          options={LANGUAGE_OPTIONS}
          selected={settings.language}
          onSelect={chooseLanguage}
        />
        {urduVoiceMissing && (
          <Text style={styles.warning} accessibilityLiveRegion="polite">{NO_URDU_VOICE}</Text>
        )}

        <TouchableOpacity
          style={styles.tutorialBtn}
          onPress={() => speak(TUTORIAL[settings.language])}
          accessibilityRole="button"
          accessibilityLabel="Play the tutorial"
          accessibilityHint="Explains the gestures and modes out loud"
        >
          <Text style={styles.tutorialText}>▶  Play the tutorial</Text>
        </TouchableOpacity>

        <View style={styles.group}>
          <Text style={styles.groupTitle} accessibilityRole="header">Gestures on the camera screen</Text>
          <Text style={styles.help}>• Tap: start or stop scanning</Text>
          <Text style={styles.help}>• Double-tap: describe everything in view now</Text>
          <Text style={styles.help}>• Long-press: repeat the last message</Text>
          <Text style={styles.help}>• Swipe left or right: change mode (Scan, Read text, Colour, Light)</Text>
          <Text style={styles.help}>
            With TalkBack on, use the actions menu for “Describe now” and “Repeat”.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0B1220' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 52, paddingBottom: 16, paddingHorizontal: 24,
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.08)',
  },
  title: { color: '#fff', fontSize: 24, fontWeight: 'bold' },
  doneBtn: {
    backgroundColor: '#01696f', paddingVertical: 10, paddingHorizontal: 22, borderRadius: 22,
  },
  doneText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  content: { padding: 24, gap: 28 },
  group: { gap: 10 },
  groupTitle: { color: '#4fc3f7', fontSize: 15, fontWeight: '700', marginBottom: 4 },
  option: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    padding: 16, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.05)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)',
  },
  optionSelected: { backgroundColor: 'rgba(46,196,182,0.15)', borderColor: '#2EC4B6' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#777' },
  radioSelected: { borderColor: '#2EC4B6', backgroundColor: '#2EC4B6' },
  optionText: { flex: 1 },
  optionLabel: { color: '#fff', fontSize: 17, fontWeight: '600' },
  optionDescription: { color: '#9aa4b2', fontSize: 13, marginTop: 2 },
  help: { color: '#c9d1d9', fontSize: 15, lineHeight: 22 },
  warning: {
    color: '#ffaa33', fontSize: 14, lineHeight: 20, marginTop: -16,
    padding: 12, borderRadius: 10, backgroundColor: 'rgba(255,140,0,0.12)',
  },
  tutorialBtn: {
    paddingVertical: 16, borderRadius: 14, alignItems: 'center',
    borderWidth: 1, borderColor: '#2EC4B6', backgroundColor: 'rgba(46,196,182,0.10)',
  },
  tutorialText: { color: '#2EC4B6', fontSize: 17, fontWeight: '700' },
});
