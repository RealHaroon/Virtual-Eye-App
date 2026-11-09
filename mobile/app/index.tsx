import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { LightSensor } from 'expo-sensors';
import { File } from 'expo-file-system';
import { useRef, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable,
  StatusBar, Animated, Platform
} from 'react-native';

// Set EXPO_PUBLIC_BACKEND_URL in mobile/.env.local (see .env.example).
const BACKEND = process.env.EXPO_PUBLIC_BACKEND_URL ?? 'http://10.143.31.81:8000';
const REQUEST_TIMEOUT_MS = 10000;

type DetectResult = { text: string; warning: boolean };

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
const detectFrame = async (uri: string): Promise<DetectResult> => {
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
  const manualOverrideRef = useRef(false); // true = user manually toggled, skip auto
  const manualTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Welcome message
  useEffect(() => {
    const timer = setTimeout(() => {
      speakAndWait('Welcome to Virtual Eye. Tap anywhere on the screen to start scanning your environment.');
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

  const detectionLoop = async (loopId: number) => {
    const isActive = () => runningRef.current && loopIdRef.current === loopId;

    await speakAndWait('Detection started. I will guide you through your surroundings.');

    while (isActive()) {
      try {
        if (!cameraRef.current) break;

        const photo = await cameraRef.current.takePictureAsync({ quality: 0.4 });
        if (!photo) break;
        if (!isActive()) {
          deletePhoto(photo.uri);
          break;
        }

        let result: DetectResult;
        try {
          result = await detectFrame(photo.uri);
        } finally {
          deletePhoto(photo.uri);
        }

        if (!isActive()) break;

        setStatus(result.text);
        setIsWarning(result.warning);

        if (result.warning) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          await speakAndWait(result.text, 0.65, 0.95);
        } else {
          await speakAndWait(result.text, 0.55, 1.0);
        }

        if (isActive()) await sleep(1500);

      } catch {
        if (!isActive()) break;
        const errMsg = 'Cannot reach server. Please check your connection.';
        setStatus('❌ ' + errMsg);
        setIsWarning(false);
        await speakAndWait(errMsg);
        await sleep(4000);
      }
    }
  };

  const startDetection = () => {
    const loopId = ++loopIdRef.current;
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
    speakAndWait('Detection stopped. Tap anywhere to start again.');
  };

  const handleScreenTap = () => {
    if (running) stopDetection();
    else startDetection();
  };

  const toggleTorch = () => {
    // Manual override stops the light sensor from changing the torch for 10 seconds
    manualOverrideRef.current = true;
    setAutoTorchEnabled(false);

    const next = !torchOn;
    setTorchOn(next);
    speakAndWait(next ? 'Flashlight on.' : 'Flashlight off.');

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
      />

      {/* Full-screen tap target. Panels above pass touches through to it,
          so tapping anywhere except the torch button starts/stops detection. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={handleScreenTap}
        accessibilityRole="button"
        accessibilityLabel={running ? 'Stop scanning' : 'Start scanning'}
        accessibilityHint={running
          ? 'Stops describing your surroundings'
          : 'Starts describing your surroundings out loud'}
      />

      {/* Top bar */}
      <View style={styles.topBar} pointerEvents="box-none">
        <Text style={styles.topBarTitle} accessibilityRole="header">👁️ Virtual Eye</Text>
        <View style={styles.topBarRight} pointerEvents="box-none">

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
            ? 'Tap anywhere on screen to stop'
            : 'Tap anywhere on screen to start'}
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