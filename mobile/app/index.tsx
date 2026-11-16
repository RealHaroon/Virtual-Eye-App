import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { LightSensor } from 'expo-sensors';
import { File } from 'expo-file-system';
import { useRef, useEffect, useState } from 'react';
import { useRouter } from 'expo-router';
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable,
  StatusBar, Animated, Platform
} from 'react-native';
import {
  createAnnouncer, describeScene, VERBOSITY_OPTIONS, type Announcement, type DetectedObject,
} from '../lib/announcer';
import { getSettings, SPEECH_RATES } from '../lib/settings';
import { detectOnDevice, loadDetector } from '../lib/onDeviceDetector';

// Detection runs on the phone by default. Optionally set EXPO_PUBLIC_BACKEND_URL
// in mobile/.env.local (see .env.example) to use the server instead: a bigger
// model plus text reading. If the server can't be reached, the app falls back
// to on-device detection and tries the server again later.
const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL || null;
const REQUEST_TIMEOUT_MS = 5000;
const SERVER_RETRY_MS = 30000;
// Pause between frames. Shorter when nothing was said, so changes are caught quickly.
const PAUSE_AFTER_SPEECH_MS = 800;
const PAUSE_WHEN_QUIET_MS = 300;
// Two taps within this time count as a double-tap.
const DOUBLE_TAP_MS = 300;

const currentRate = () => SPEECH_RATES[getSettings().speechSpeed];

type ServerResult = {
  text: string;
  warning: boolean;
  // Sent by newer servers; older ones only send text/warning.
  objects?: DetectedObject[];
  ocr?: string | null;
};

type FrameAnalysis =
  | { kind: 'objects'; objects: DetectedObject[]; ocr: string | null }
  | { kind: 'legacy'; text: string; warning: boolean };

const speakAndWait = (text: string, rate = 0.55, pitch = 1.0): Promise<void> => {
  return new Promise((resolve) => {
    Speech.stop();
    Speech.speak(text, {
      language: 'en-US',
      rate,
      pitch,
      volume: 1.0,
      onDone: () => resolve(),
      onError: () => resolve(),
      onStopped: () => resolve(),
    });
  });
};

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

// Sends one frame to the server. Throws on timeout or a non-2xx response.
const detectOnServer = async (uri: string): Promise<ServerResult> => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const formData = new FormData();
    formData.append('file', { uri, type: 'image/jpeg', name: 'frame.jpg' } as any);
    const res = await fetch(`${BACKEND}/detect`, {
      method: 'POST',
      body: formData,
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Server responded ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
};

const deletePhoto = (uri: string) => {
  try {
    new File(uri).delete();
  } catch {
    // Already gone or not deletable; the OS cleans the cache eventually.
  }
};

export default function HomeScreen() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState('Tap anywhere to start');
  const [running, setRunning] = useState(false);
  const [isWarning, setIsWarning] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [autoTorchEnabled, setAutoTorchEnabled] = useState(false); // shows 'AUTO' label

  const cameraRef = useRef<CameraView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const runningRef = useRef(false);
  // Each detection loop gets an id; a loop stops as soon as a newer one starts.
  const loopIdRef = useRef(0);
  // Remembers what was already said, so only changes are announced.
  const announcerRef = useRef(createAnnouncer());
  const manualOverrideRef = useRef(false); // true = user manually toggled, skip auto
  const manualTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // While the server is unreachable, skip it until this time (ms since epoch).
  const serverRetryAtRef = useRef(0);
  const usingServerRef = useRef(BACKEND !== null);
  // Gestures: last message (long-press repeats it), pending double-tap, describe-now requests.
  const lastSpokenRef = useRef<string | null>(null);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const describeRequestedRef = useRef(false);
  const describeBusyRef = useRef(false);

  /** Speaks at the user's chosen speed and remembers the message for "repeat". */
  const say = (text: string, urgent = false) => {
    lastSpokenRef.current = text;
    return speakAndWait(text, currentRate() + (urgent ? 0.1 : 0), urgent ? 0.95 : 1.0);
  };

  // Load the on-device model early so the first scan starts quickly.
  useEffect(() => {
    loadDetector().catch(() => {
      // Reported when detection is actually attempted.
    });
  }, []);

  // Welcome message
  useEffect(() => {
    const timer = setTimeout(() => {
      speakAndWait(
        'Welcome to Virtual Eye. Tap anywhere to start scanning. ' +
        'Double-tap to describe everything in view. Long-press to repeat the last message.',
        currentRate(),
      );
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
      if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
      Speech.stop();
    };
  }, []);

  // Auto torch via light sensor (Android only)
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    let sub: { remove: () => void } | undefined;
    let cancelled = false;

    const startSensor = async () => {
      const isAvailable = await LightSensor.isAvailableAsync();
      if (!isAvailable || cancelled) return;

      LightSensor.setUpdateInterval(2000); // check every 2 seconds

      sub = LightSensor.addListener(({ illuminance }) => {
        if (manualOverrideRef.current) return; // user manually set it, don't override

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

  // Server when configured and reachable, otherwise the phone. `notice` is set
  // when switching between the two, so the user knows what changed.
  const analyzeFrame = async (uri: string): Promise<{ analysis: FrameAnalysis; notice: string | null }> => {
    if (BACKEND && Date.now() >= serverRetryAtRef.current) {
      try {
        const result = await detectOnServer(uri);
        const notice = usingServerRef.current ? null : 'Connected to server.';
        usingServerRef.current = true;
        const analysis: FrameAnalysis = result.objects
          ? { kind: 'objects', objects: result.objects, ocr: result.ocr ?? null }
          : { kind: 'legacy', text: result.text, warning: result.warning };
        return { analysis, notice };
      } catch {
        serverRetryAtRef.current = Date.now() + SERVER_RETRY_MS;
      }
    }
    const notice = usingServerRef.current
      ? 'Server not reachable. Using on-device detection. Text reading is paused.'
      : null;
    usingServerRef.current = false;
    const objects = await detectOnDevice(uri);
    return { analysis: { kind: 'objects', objects, ocr: null }, notice };
  };

  const detectionLoop = async (loopId: number) => {
    const isActive = () => runningRef.current && loopIdRef.current === loopId;

    await say('Detection started. I will guide you through your surroundings.');

    while (isActive()) {
      try {
        if (!cameraRef.current) break;

        // No click and no screen flash: a frame is taken about every second.
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.4, shutterSound: false });
        if (!photo) break;
        if (!isActive()) {
          deletePhoto(photo.uri);
          break;
        }

        let frame: Awaited<ReturnType<typeof analyzeFrame>>;
        try {
          frame = await analyzeFrame(photo.uri);
        } finally {
          deletePhoto(photo.uri);
        }

        if (!isActive()) break;

        if (frame.notice) await say(frame.notice);

        const { analysis } = frame;
        const announcement: Announcement = analysis.kind === 'objects'
          ? announcerRef.current.update(analysis.objects, analysis.ocr)
          : { speech: analysis.text, warning: analysis.warning, summary: analysis.text };

        setStatus(announcement.summary);
        setIsWarning(announcement.warning);

        // A double-tap during scanning asks for the full picture on the next frame.
        let speech = announcement.speech;
        if (describeRequestedRef.current) {
          describeRequestedRef.current = false;
          speech = analysis.kind === 'objects' ? describeScene(analysis.objects, analysis.ocr) : analysis.text;
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
        const errMsg = 'Detection is not working right now. Trying again.';
        setStatus('❌ ' + errMsg);
        setIsWarning(false);
        await say(errMsg);
        await sleep(4000);
      }
    }
  };

  const startDetection = () => {
    const loopId = ++loopIdRef.current;
    announcerRef.current = createAnnouncer(VERBOSITY_OPTIONS[getSettings().verbosity]);
    serverRetryAtRef.current = 0; // give the server a fresh chance on every start
    runningRef.current = true;
    setRunning(true);
    setIsWarning(false);
    setStatus('Scanning environment...');
    detectionLoop(loopId);
  };

  const stopDetection = () => {
    runningRef.current = false;
    loopIdRef.current++;
    setRunning(false);
    setIsWarning(false);
    setStatus('Tap anywhere to start');
    say('Detection stopped. Tap anywhere to start again.');
  };

  const handleScreenTap = () => {
    if (running) stopDetection();
    else startDetection();
  };

  /** Describes everything in view right now, not just what changed. */
  const describeNow = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (runningRef.current) {
      describeRequestedRef.current = true;
      Speech.stop(); // cut the current message so the description comes quickly
      return;
    }
    if (describeBusyRef.current || !cameraRef.current) return;
    describeBusyRef.current = true;
    try {
      setStatus('Looking...');
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.4, shutterSound: false });
      if (!photo) return;
      let frame: Awaited<ReturnType<typeof analyzeFrame>>;
      try {
        frame = await analyzeFrame(photo.uri);
      } finally {
        deletePhoto(photo.uri);
      }
      const { analysis } = frame;
      const text = analysis.kind === 'objects' ? describeScene(analysis.objects, analysis.ocr) : analysis.text;
      setStatus(text);
      await say(text);
    } catch {
      setStatus('Tap anywhere to start');
      await say('I could not look right now. Please try again.');
    } finally {
      describeBusyRef.current = false;
    }
  };

  const repeatLast = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    say(lastSpokenRef.current ?? 'Nothing to repeat yet.');
  };

  // One tap toggles scanning; a second tap within DOUBLE_TAP_MS makes it a double-tap.
  const handlePress = () => {
    if (tapTimerRef.current) {
      clearTimeout(tapTimerRef.current);
      tapTimerRef.current = null;
      describeNow();
      return;
    }
    tapTimerRef.current = setTimeout(() => {
      tapTimerRef.current = null;
      handleScreenTap();
    }, DOUBLE_TAP_MS);
  };

  const openSettings = () => {
    if (running) {
      runningRef.current = false;
      loopIdRef.current++;
      setRunning(false);
      setIsWarning(false);
      setStatus('Tap anywhere to start');
    }
    Speech.stop();
    router.push('/settings');
  };

  const toggleTorch = () => {
    // Manual override stops the light sensor from changing the torch for 10 seconds
    manualOverrideRef.current = true;
    setAutoTorchEnabled(false);

    const next = !torchOn;
    setTorchOn(next);
    say(next ? 'Flashlight on.' : 'Flashlight off.');

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

      {/* Full-screen tap target. Panels above pass touches through to it, so
          anywhere except the top-bar buttons works: tap = start/stop,
          double-tap = describe now, long-press = repeat. With TalkBack, the
          same actions are in the actions menu. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={handlePress}
        onLongPress={repeatLast}
        delayLongPress={600}
        accessibilityRole="button"
        accessibilityLabel={running ? 'Stop scanning' : 'Start scanning'}
        accessibilityHint={running
          ? 'Stops describing your surroundings. More actions available.'
          : 'Starts describing your surroundings out loud. More actions available.'}
        accessibilityActions={[
          { name: 'activate' },
          { name: 'longpress', label: 'Repeat last message' },
          { name: 'describe', label: 'Describe everything now' },
        ]}
        onAccessibilityAction={({ nativeEvent }) => {
          if (nativeEvent.actionName === 'activate') handleScreenTap();
          else if (nativeEvent.actionName === 'longpress') repeatLast();
          else if (nativeEvent.actionName === 'describe') describeNow();
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
            accessibilityHint="Speech speed and how much to say"
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
        <View style={[styles.statusBox, isWarning && styles.statusBoxWarning]}>
          <Text style={styles.statusIcon} importantForAccessibility="no">
            {isWarning ? '⚠️' : running ? '🔍' : '💤'}
          </Text>
          <Text style={[styles.statusText, isWarning && styles.statusTextWarning]}>
            {status}
          </Text>
        </View>

        <Animated.View
          style={{ transform: [{ scale: pulseAnim }], width: '100%' }}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <View style={running ? styles.btnStop : styles.btnStart}>
            <Text style={styles.btnText}>
              {running ? '⏹  Tap to Stop' : '▶  Tap to Start'}
            </Text>
          </View>
        </Animated.View>

        <Text style={styles.hint} importantForAccessibility="no">
          {running
            ? 'Tap: stop · Double-tap: describe · Hold: repeat'
            : 'Tap: start · Double-tap: describe · Hold: repeat'}
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
});