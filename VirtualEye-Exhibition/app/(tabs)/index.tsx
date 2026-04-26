import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { useRef, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  StatusBar, Animated
} from 'react-native';

const BACKEND = 'http://192.168.100.15:8000';

// Wait until speech is fully done
const speakAndWait = (text: string, rate = 0.55, pitch = 1.0): Promise<void> => {
  return new Promise((resolve) => {
    Speech.stop();
    Speech.speak(text, {
      language: 'en-US',
      rate,
      pitch,
      volume: 1.0,
      onDone: () => resolve(),
      onError: () => resolve(), // resolve even on error so loop continues
      onStopped: () => resolve(),
    });
  });
};

// Small pause between detections (ms)
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

export default function HomeScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState('Tap anywhere to start');
  const [running, setRunning] = useState(false);
  const [isWarning, setIsWarning] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const runningRef = useRef(false); // track running state inside async loop

  // Welcome message on launch
  useEffect(() => {
    const timer = setTimeout(() => {
      speakAndWait('Welcome to Virtual Eye. Tap anywhere on the screen to start scanning your environment.');
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  // Pulse when running
  useEffect(() => {
    if (running) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.12, duration: 900, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 900, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.stopAnimation();
      pulseAnim.setValue(1);
    }
  }, [running]);

  const detectionLoop = async () => {
    await speakAndWait('Detection started. I will guide you through your surroundings.');

    while (runningRef.current) {
      try {
        if (!cameraRef.current) break;

        const photo = await cameraRef.current.takePictureAsync({ quality: 0.4 });
        if (!photo || !runningRef.current) break;

        const formData = new FormData();
        formData.append('file', { uri: photo.uri, type: 'image/jpeg', name: 'frame.jpg' } as any);

        const res = await fetch(`${BACKEND}/detect`, { method: 'POST', body: formData });
        const { text, warning } = await res.json();

        if (!runningRef.current) break; // stopped while waiting for response

        setStatus(text);
        setIsWarning(warning);

        if (warning) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          await speakAndWait(text, 0.65, 0.95); // slightly faster for warnings
        } else {
          await speakAndWait(text, 0.55, 1.0); // calm and full speed
        }

        // Short pause after speech before next scan
        if (runningRef.current) await sleep(1500);

      } catch (e) {
        if (!runningRef.current) break;
        const errMsg = 'Cannot reach server. Please check your connection.';
        setStatus('❌ ' + errMsg);
        setIsWarning(false);
        await speakAndWait(errMsg);
        await sleep(4000); // wait longer on error before retrying
      }
    }
  };

  const startDetection = () => {
    runningRef.current = true;
    setRunning(true);
    setIsWarning(false);
    setStatus('Scanning environment...');
    detectionLoop();
  };

  const stopDetection = () => {
    runningRef.current = false;
    setRunning(false);
    setIsWarning(false);
    setStatus('Tap anywhere to start');
    Speech.stop();
    speakAndWait('Detection stopped. Tap anywhere to start again.');
  };

  const handleScreenTap = () => {
    if (running) stopDetection();
    else startDetection();
  };

  const toggleTorch = () => {
    setTorchOn(prev => {
      const next = !prev;
      speakAndWait(next ? 'Flashlight on.' : 'Flashlight off.');
      return next;
    });
  };

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <TouchableOpacity
        style={styles.permissionContainer}
        onPress={requestPermission}
        activeOpacity={0.9}
      >
        <Text style={styles.permissionIcon}>📷</Text>
        <Text style={styles.permissionTitle}>Camera Access Needed</Text>
        <Text style={styles.permissionSub}>Tap anywhere to allow camera access</Text>
      </TouchableOpacity>
    );
  }

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={handleScreenTap}
      activeOpacity={1}
    >
      <StatusBar barStyle="light-content" backgroundColor="#000" />

      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing="back"
        enableTorch={torchOn}
      />

      {/* Top bar */}
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>👁️ Virtual Eye</Text>
        <View style={styles.topBarRight}>
          <TouchableOpacity
            onPress={(e) => { e.stopPropagation(); toggleTorch(); }}
            style={[styles.torchBtn, torchOn && styles.torchBtnActive]}
          >
            <Text style={styles.torchIcon}>🔦</Text>
            <Text style={styles.torchLabel}>{torchOn ? 'ON' : 'OFF'}</Text>
          </TouchableOpacity>
          <View style={[styles.liveDot, running && styles.liveDotActive]} />
        </View>
      </View>

      {/* Bottom panel */}
      <View style={styles.overlay}>
        <View style={[styles.statusBox, isWarning && styles.statusBoxWarning]}>
          <Text style={styles.statusIcon}>
            {isWarning ? '⚠️' : running ? '🔍' : '💤'}
          </Text>
          <Text style={[styles.statusText, isWarning && styles.statusTextWarning]}>
            {status}
          </Text>
        </View>

        <Animated.View style={{ transform: [{ scale: pulseAnim }], width: '100%' }}>
          <View style={running ? styles.btnStop : styles.btnStart}>
            <Text style={styles.btnText}>
              {running ? '⏹  Tap to Stop' : '▶  Tap to Start'}
            </Text>
          </View>
        </Animated.View>

        <Text style={styles.hint}>
          {running
            ? 'Tap anywhere on screen to stop'
            : 'Tap anywhere on screen to start'}
        </Text>
      </View>
    </TouchableOpacity>
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