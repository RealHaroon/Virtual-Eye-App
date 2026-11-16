import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Haptics from 'expo-haptics';
import { Accelerometer, LightSensor } from 'expo-sensors';
import { File } from 'expo-file-system';
import { useRef, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  View, Text, StyleSheet, TouchableOpacity, StatusBar, Animated, Platform,
} from 'react-native';
import {
  CLOSE_AREA, createAnnouncer, describeScene, VERBOSITY_OPTIONS, type Announcement, type DetectedObject,
} from '../lib/announcer';
import { createFaceDownTracker } from '../lib/battery';
import { dominantColours, meanLuminance } from '../lib/colour';
import { cycle } from '../lib/gestures';
import {
  colourSentence, lightSentence, modeIntro, modeName, MODES, msg, TUTORIAL, type Mode,
} from '../lib/i18n';
import { centreCrop, loadRgb } from '../lib/imagePixels';
import { lightLevel } from '../lib/light';
import { detectOnDevice, loadDetector } from '../lib/onDeviceDetector';
import { readTextOnDevice } from '../lib/onDeviceOcr';
import { BACKEND_URL, detectOnServer } from '../lib/serverDetector';
import { getSettings, updateSettings, useSettings } from '../lib/settings';
import { speak, stopSpeaking } from '../lib/speech';
import { useScreenGestures } from '../lib/useScreenGestures';

// Detection and text reading run on the phone. If a server is configured
// (lib/serverDetector.ts) it is used instead; when it can't be reached the app
// falls back to the phone and tries the server again after SERVER_RETRY_MS.
const SERVER_RETRY_MS = 30000;
// Pause between frames. Shorter when nothing was said, so changes are caught quickly.
const PAUSE_AFTER_SPEECH_MS = 800;
const PAUSE_WHEN_QUIET_MS = 300;

type FrameAnalysis =
  | { kind: 'objects'; objects: DetectedObject[]; ocr: string | null }
  | { kind: 'legacy'; text: string; warning: boolean };

type Photo = { uri: string; width: number; height: number };

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));
const lang = () => getSettings().language;

const deletePhoto = (uri: string) => {
  try {
    new File(uri).delete();
  } catch {
    // Already gone or not deletable; the OS cleans the cache eventually.
  }
};

/** Short label for what a tap does, read by TalkBack. */
function tapActionLabel(mode: Mode, running: boolean): string {
  if (mode === 'colour') return 'Colour mode. Identify colour';
  if (mode === 'light') return 'Light mode. Check how bright it is';
  const name = mode === 'read' ? 'Read text mode' : 'Scan mode';
  return `${name}. ${running ? 'Stop' : 'Start'}`;
}

export default function HomeScreen() {
  const router = useRouter();
  const { language } = useSettings();
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState<string | null>(null); // null = show the mode's intro
  const [running, setRunning] = useState(false);
  const [isWarning, setIsWarning] = useState(false);
  const [mode, setMode] = useState<Mode>('scan');
  const [torchOn, setTorchOn] = useState(false);
  const [autoTorchEnabled, setAutoTorchEnabled] = useState(false); // shows 'AUTO' label

  const cameraRef = useRef<CameraView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const runningRef = useRef(false);
  const modeRef = useRef<Mode>('scan');
  // Each detection loop gets an id; a loop stops as soon as a newer one starts.
  const loopIdRef = useRef(0);
  // Remembers what was already said, so only changes are announced.
  const announcerRef = useRef(createAnnouncer());
  const manualOverrideRef = useRef(false); // true = user manually toggled torch, skip auto
  const manualTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // While the server is unreachable, skip it until this time (ms since epoch).
  const serverRetryAtRef = useRef(0);
  const usingServerRef = useRef(BACKEND_URL !== null);
  const lastSpokenRef = useRef<string | null>(null); // long-press repeats it
  const describeRequestedRef = useRef(false); // double-tap while scanning
  const busyRef = useRef(false); // a one-shot look (colour, light, describe) is running
  const luxRef = useRef<number | null>(null); // latest light-sensor reading
  const pausedRef = useRef(false); // battery saver: phone is face down

  /** Speaks and remembers the message for "repeat". */
  const say = (text: string, urgent = false) => {
    lastSpokenRef.current = text;
    return speak(text, { urgent });
  };

  // Load the on-device model early so the first scan starts quickly.
  useEffect(() => {
    loadDetector().catch(() => {
      // Reported when detection is actually attempted.
    });
  }, []);

  // First launch: spoken tutorial. Afterwards: a short welcome.
  useEffect(() => {
    const timer = setTimeout(() => {
      const { tutorialSeen, language: current } = getSettings();
      const text = tutorialSeen ? msg('welcome', current) : TUTORIAL[current];
      lastSpokenRef.current = text;
      speak(text);
      if (!tutorialSeen) updateSettings({ tutorialSeen: true });
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  // Stop everything when the screen unmounts
  useEffect(() => {
    return () => {
      runningRef.current = false;
      // Intentional: invalidates any loop still running after unmount.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      loopIdRef.current++;
      if (manualTimerRef.current) clearTimeout(manualTimerRef.current);
      stopSpeaking();
    };
  }, []);

  // Light sensor (Android only): auto torch, and readings for Light mode
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    let sub: { remove: () => void } | undefined;
    let cancelled = false;

    const startSensor = async () => {
      const isAvailable = await LightSensor.isAvailableAsync();
      if (!isAvailable || cancelled) return;

      LightSensor.setUpdateInterval(2000); // check every 2 seconds

      sub = LightSensor.addListener(({ illuminance }) => {
        luxRef.current = illuminance;
        if (manualOverrideRef.current) return; // user manually set the torch, don't override

        const isDark = illuminance < 15; // below 15 lux = dark
        setAutoTorchEnabled(isDark);
        setTorchOn(isDark);
      });
    };

    startSensor();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, []);

  // Battery saver: while scanning, pause when the phone lies face down and
  // resume when it is picked up. The accelerometer only runs while scanning.
  useEffect(() => {
    if (!running) return;
    let sub: { remove: () => void } | undefined;
    let cancelled = false;
    const tracker = createFaceDownTracker(Platform.OS);

    Accelerometer.isAvailableAsync().then(available => {
      if (!available || cancelled) return;
      Accelerometer.setUpdateInterval(500);
      sub = Accelerometer.addListener(({ z }) => {
        const action = tracker.update(z, Date.now());
        if (!action) return;
        pausedRef.current = action === 'pause';
        const text = msg(action === 'pause' ? 'pausedFaceDown' : 'resumed', getSettings().language);
        setStatus(action === 'pause' ? text : '…');
        lastSpokenRef.current = text;
        speak(text);
      });
    });

    return () => {
      cancelled = true;
      sub?.remove();
      pausedRef.current = false;
    };
  }, [running]);

  // Pulse animation
  useEffect(() => {
    if (!running) return;
    const anim = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.12, duration: 900, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
      ])
    );
    anim.start();
    return () => {
      anim.stop();
      pulseAnim.setValue(1);
    };
  }, [running, pulseAnim]);

  const takePhoto = async (): Promise<Photo | undefined> =>
    // No click and no screen flash: a frame is taken about every second.
    cameraRef.current?.takePictureAsync({ quality: 0.4, shutterSound: false });

  // Server when configured and reachable, otherwise the phone. `notice` is set
  // when switching between the two, so the user knows what changed.
  const analyzeFrame = async (
    uri: string,
    { readAllText = false } = {},
  ): Promise<{ analysis: FrameAnalysis; notice: string | null }> => {
    if (BACKEND_URL && Date.now() >= serverRetryAtRef.current) {
      try {
        const result = await detectOnServer(uri);
        const notice = usingServerRef.current ? null : msg('serverBack', lang());
        usingServerRef.current = true;
        const analysis: FrameAnalysis = result.objects
          ? { kind: 'objects', objects: result.objects, ocr: result.ocr ?? null }
          : { kind: 'legacy', text: result.text, warning: result.warning };
        return { analysis, notice };
      } catch {
        serverRetryAtRef.current = Date.now() + SERVER_RETRY_MS;
      }
    }
    const notice = usingServerRef.current ? msg('serverDown', lang()) : null;
    usingServerRef.current = false;
    const objects = await detectOnDevice(uri);
    // Skip text while something is very close so warnings come first (except in Read mode).
    const somethingClose = objects.some(obj => obj.area >= CLOSE_AREA);
    const ocr = readAllText || !somethingClose ? await readTextOnDevice(uri) : null;
    return { analysis: { kind: 'objects', objects, ocr }, notice };
  };

  const detectionLoop = async (loopId: number) => {
    const isActive = () => runningRef.current && loopIdRef.current === loopId;
    const reading = modeRef.current === 'read';

    await say(msg(reading ? 'readingStarted' : 'detectionStarted', lang()));

    while (isActive()) {
      if (pausedRef.current) {
        await sleep(500); // battery saver: no photos while face down
        continue;
      }
      try {
        const photo = await takePhoto();
        if (!photo) break;
        if (!isActive()) {
          deletePhoto(photo.uri);
          break;
        }

        let frame: Awaited<ReturnType<typeof analyzeFrame>>;
        try {
          frame = await analyzeFrame(photo.uri, { readAllText: reading });
        } finally {
          deletePhoto(photo.uri);
        }

        if (!isActive()) break;

        if (frame.notice) await say(frame.notice);

        const { analysis } = frame;
        let announcement: Announcement;
        if (analysis.kind === 'objects') {
          // Read mode: only text, plus warnings about very close objects.
          const objects = reading
            ? analysis.objects.filter(obj => obj.area >= CLOSE_AREA)
            : analysis.objects;
          announcement = announcerRef.current.update(objects, analysis.ocr);
        } else {
          announcement = { speech: analysis.text, warning: analysis.warning, summary: analysis.text };
        }

        setStatus(announcement.summary);
        setIsWarning(announcement.warning);

        // A double-tap during scanning asks for the full picture on the next frame.
        let speech = announcement.speech;
        if (describeRequestedRef.current) {
          describeRequestedRef.current = false;
          speech = analysis.kind === 'objects'
            ? describeScene(analysis.objects, analysis.ocr, { language: lang() })
            : analysis.text;
        }

        if (speech) {
          if (announcement.warning) {
            await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          }
          await say(speech, announcement.warning);
        }

        if (isActive()) {
          await sleep(speech ? PAUSE_AFTER_SPEECH_MS : PAUSE_WHEN_QUIET_MS);
        }

      } catch {
        if (!isActive()) break;
        const errMsg = msg('detectionError', lang());
        setStatus('❌ ' + errMsg);
        setIsWarning(false);
        await say(errMsg);
        await sleep(4000);
      }
    }
  };

  const startLoop = () => {
    const loopId = ++loopIdRef.current;
    const { verbosity, language: current } = getSettings();
    announcerRef.current = createAnnouncer({
      ...VERBOSITY_OPTIONS[verbosity],
      language: current,
      // Reading text: no "path clear" updates between texts.
      ...(modeRef.current === 'read' ? { heartbeatMs: Infinity } : {}),
    });
    serverRetryAtRef.current = 0; // give the server a fresh chance on every start
    runningRef.current = true;
    setRunning(true);
    setIsWarning(false);
    setStatus('…');
    detectionLoop(loopId);
  };

  const stopLoop = ({ silent = false } = {}) => {
    runningRef.current = false;
    loopIdRef.current++;
    setRunning(false);
    setIsWarning(false);
    setStatus(null);
    if (!silent) say(msg('stopped', lang()));
  };

  /** Takes one photo, turns it into a sentence, shows and speaks it. */
  const lookOnce = async (describe: (photo: Photo) => Promise<string>) => {
    if (busyRef.current || !cameraRef.current) return;
    busyRef.current = true;
    try {
      setStatus('…');
      const photo = await takePhoto();
      if (!photo) return;
      let text: string;
      try {
        text = await describe(photo);
      } finally {
        deletePhoto(photo.uri);
      }
      setStatus(text);
      await say(text);
    } catch {
      setStatus(null);
      await say(msg('couldNotLook', lang()));
    } finally {
      busyRef.current = false;
    }
  };

  const identifyColour = () => lookOnce(async photo => {
    // A small square from the middle of the view: what the camera is pointed at.
    const rgb = await loadRgb(photo.uri, 24, 24, centreCrop(photo.width, photo.height));
    const { main, second } = dominantColours(rgb);
    return colourSentence(main, second, lang());
  });

  const checkLight = async () => {
    // The light sensor measures real brightness; the camera adjusts its exposure,
    // so it is only used on phones without a sensor.
    if (luxRef.current !== null) {
      const text = lightSentence(lightLevel(luxRef.current, null), lang());
      setStatus(text);
      await say(text);
      return;
    }
    await lookOnce(async photo => {
      const rgb = await loadRgb(photo.uri, 32, 32);
      return lightSentence(lightLevel(null, meanLuminance(rgb)), lang());
    });
  };

  /** Double-tap: everything in view now, not just what changed. */
  const describeNow = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (runningRef.current) {
      describeRequestedRef.current = true;
      stopSpeaking(); // cut the current message so the description comes quickly
      return;
    }
    if (modeRef.current === 'colour') return identifyColour();
    if (modeRef.current === 'light') return checkLight();
    const reading = modeRef.current === 'read';
    return lookOnce(async photo => {
      const { analysis } = await analyzeFrame(photo.uri, { readAllText: reading });
      if (analysis.kind === 'legacy') return analysis.text;
      if (reading && !analysis.ocr) return msg('noTextFound', lang());
      return describeScene(analysis.objects, analysis.ocr, { language: lang() });
    });
  };

  const onTap = () => {
    const current = modeRef.current;
    if (current === 'colour') identifyColour();
    else if (current === 'light') checkLight();
    else if (runningRef.current) stopLoop();
    else startLoop();
  };

  const changeMode = (direction: 'swipeLeft' | 'swipeRight') => {
    const next = cycle(MODES, modeRef.current, direction);
    if (runningRef.current) stopLoop({ silent: true });
    modeRef.current = next;
    setMode(next);
    setStatus(null);
    Haptics.selectionAsync();
    say(modeIntro(next, lang()));
  };

  const repeatLast = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    say(lastSpokenRef.current ?? msg('nothingToRepeat', lang()));
  };

  const gestureHandlers = useScreenGestures({
    onTap,
    onDoubleTap: describeNow,
    onLongPress: repeatLast,
    onSwipe: changeMode,
  });

  const openSettings = () => {
    if (runningRef.current) stopLoop({ silent: true });
    stopSpeaking();
    router.push('/settings');
  };

  const toggleTorch = () => {
    // Manual override stops the light sensor from changing the torch for 10 seconds
    manualOverrideRef.current = true;
    setAutoTorchEnabled(false);

    const next = !torchOn;
    setTorchOn(next);
    say(msg(next ? 'flashlightOn' : 'flashlightOff', lang()));

    if (manualTimerRef.current) clearTimeout(manualTimerRef.current);
    manualTimerRef.current = setTimeout(() => {
      manualOverrideRef.current = false;
    }, 10000);
  };

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <TouchableOpacity
        style={styles.permissionContainer}
        onPress={requestPermission}
        activeOpacity={0.9}
        accessibilityRole="button"
        accessibilityLabel="Allow camera access"
        accessibilityHint="Virtual Eye needs the camera to describe your surroundings"
      >
        <Text style={styles.permissionIcon}>📷</Text>
        <Text style={styles.permissionTitle}>Camera Access Needed</Text>
        <Text style={styles.permissionSub}>Tap anywhere to allow camera access</Text>
      </TouchableOpacity>
    );
  }

  const torchLabel = autoTorchEnabled ? 'AUTO' : torchOn ? 'ON' : 'OFF';
  const isLoopMode = mode === 'scan' || mode === 'read';
  const buttonText = !isLoopMode ? '◉  Tap to check' : running ? '⏹  Tap to Stop' : '▶  Tap to Start';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        enableTorch={torchOn}
        animateShutter={false}
      />

      {/* Full-screen gesture area. Panels above pass touches through to it, so
          anywhere except the top-bar buttons works: tap, double-tap = describe,
          long-press = repeat, swipe = change mode. With TalkBack, the same
          actions are in the actions menu. */}
      <View
        style={StyleSheet.absoluteFill}
        {...gestureHandlers}
        accessible
        accessibilityRole="button"
        accessibilityLabel={tapActionLabel(mode, running)}
        accessibilityHint="More actions available, including changing mode."
        accessibilityActions={[
          { name: 'activate' },
          { name: 'longpress', label: 'Repeat last message' },
          { name: 'describe', label: 'Describe everything now' },
          { name: 'nextMode', label: 'Next mode' },
          { name: 'previousMode', label: 'Previous mode' },
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          switch (nativeEvent.actionName) {
            case 'activate': onTap(); break;
            case 'longpress': repeatLast(); break;
            case 'describe': describeNow(); break;
            case 'nextMode': changeMode('swipeLeft'); break;
            case 'previousMode': changeMode('swipeRight'); break;
          }
        }}
      />

      {/* Top bar */}
      <View style={styles.topBar} pointerEvents="box-none">
        <Text style={styles.topBarTitle} accessibilityRole="header">👁️ Virtual Eye</Text>
        <View style={styles.topBarRight} pointerEvents="box-none">

          <TouchableOpacity
            onPress={openSettings}
            style={styles.torchBtn}
            accessibilityRole="button"
            accessibilityLabel="Settings"
            accessibilityHint="Language, speech speed and how much to say"
          >
            <Text style={styles.torchIcon}>⚙️</Text>
          </TouchableOpacity>

          {/* Torch button — shows AUTO label when sensor is controlling it */}
          <TouchableOpacity
            onPress={toggleTorch}
            style={[styles.torchBtn, torchOn && styles.torchBtnActive]}
            accessibilityRole="switch"
            accessibilityLabel="Flashlight"
            accessibilityState={{ checked: torchOn }}
            accessibilityHint={autoTorchEnabled
              ? 'Currently controlled automatically by the light sensor'
              : undefined}
          >
            <Text style={styles.torchIcon}>🔦</Text>
            <Text style={styles.torchLabel}>{torchLabel}</Text>
          </TouchableOpacity>

          <View
            style={[styles.liveDot, running && styles.liveDotActive]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </View>
      </View>

      {/* Bottom panel (display only, touches pass through) */}
      <View style={styles.overlay} pointerEvents="none">
        <View
          style={styles.modeRow}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {MODES.map(m => (
            <Text key={m} style={[styles.modeChip, m === mode && styles.modeChipActive]}>
              {modeName(m, language)}
            </Text>
          ))}
        </View>

        <View style={[styles.statusBox, isWarning && styles.statusBoxWarning]}>
          <Text style={styles.statusIcon} importantForAccessibility="no">
            {isWarning ? '⚠️' : running ? '🔍' : '💤'}
          </Text>
          <Text style={[styles.statusText, isWarning && styles.statusTextWarning]}>
            {status ?? modeIntro(mode, language)}
          </Text>
        </View>

        <Animated.View
          style={{ transform: [{ scale: pulseAnim }], width: '100%' }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={running ? styles.btnStop : styles.btnStart}>
            <Text style={styles.btnText}>{buttonText}</Text>
          </View>
        </Animated.View>

        <Text style={styles.hint} importantForAccessibility="no">
          Double-tap: describe · Hold: repeat · Swipe: change mode
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },

  permissionContainer: {
    flex: 1, backgroundColor: '#0a0a0a',
    justifyContent: 'center', alignItems: 'center', padding: 32
  },
  permissionIcon: { fontSize: 60, marginBottom: 16 },
  permissionTitle: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 10 },
  permissionSub: { color: '#aaa', fontSize: 14, textAlign: 'center' },

  camera: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.65)', paddingTop: 48, paddingBottom: 12,
    paddingHorizontal: 24, zIndex: 2
  },
  topBarTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  topBarRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },

  torchBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    backgroundColor: 'rgba(255,255,255,0.1)',
    paddingVertical: 5, paddingHorizontal: 10,
    borderRadius: 20, borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.15)'
  },
  torchBtnActive: {
    backgroundColor: 'rgba(255,220,50,0.25)',
    borderColor: 'rgba(255,220,50,0.6)'
  },
  torchIcon: { fontSize: 14 },
  torchLabel: { color: '#fff', fontSize: 11, fontWeight: '600' },

  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#555' },
  liveDotActive: { backgroundColor: '#4caf50' },

  overlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    padding: 24, alignItems: 'center',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    zIndex: 2
  },

  statusBox: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16, paddingVertical: 16, paddingHorizontal: 20,
    marginBottom: 20, width: '100%', minHeight: 90,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)'
  },
  statusBoxWarning: {
    backgroundColor: 'rgba(255,140,0,0.15)',
    borderColor: 'rgba(255,140,0,0.4)'
  },
  statusIcon: { fontSize: 24, marginBottom: 8 },
  statusText: { color: '#4fc3f7', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  statusTextWarning: { color: '#ffaa33', fontWeight: '700', fontSize: 16 },

  btnStart: {
    backgroundColor: '#01696f', paddingVertical: 18,
    borderRadius: 30, width: '100%', alignItems: 'center',
    shadowColor: '#01696f', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8
  },
  btnStop: {
    backgroundColor: '#a12c7b', paddingVertical: 18,
    borderRadius: 30, width: '100%', alignItems: 'center',
    shadowColor: '#a12c7b', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8
  },
  btnText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  hint: { color: '#666', fontSize: 12, marginTop: 12 },

  modeRow: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginBottom: 14, flexWrap: 'wrap' },
  modeChip: {
    color: '#9aa4b2', fontSize: 13, fontWeight: '600',
    paddingVertical: 5, paddingHorizontal: 12, borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.06)', overflow: 'hidden',
  },
  modeChipActive: { color: '#0B1220', backgroundColor: '#2EC4B6' },
});
