import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { useRef, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  StatusBar, Animated
} from 'react-native';

const BACKEND = 'http://192.168.100.15:8000';

// Soft calm voice for normal detections
const speak = (text: string) => {
  Speech.stop();
  Speech.speak(text, {
    language: 'en',
    rate: 0.75,
    pitch: 0.90,
    volume: 1.0,
  });
};

// Slightly urgent but still calm for warnings
const speakWarning = (text: string) => {
  Speech.stop();
  Speech.speak(text, {
    language: 'en',
    rate: 0.88,
    pitch: 0.80,
    volume: 1.0,
  });
};

export default function HomeScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState('Tap anywhere to start');
  const [running, setRunning] = useState(false);
  const [isWarning, setIsWarning] = useState(false);

  const cameraRef = useRef<CameraView>(null);
  const intervalRef = useRef<any>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const warningAnim = useRef(new Animated.Value(0)).current;

  // Speak welcome instructions when app opens
  useEffect(() => {
    const timer = setTimeout(() => {
      speak('Welcome to Virtual Eye. Tap anywhere on the screen to start scanning your environment.');
    }, 800);
    return () => clearTimeout(timer);
  }, []);

  // Pulse animation when running
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

  // Warning flash animation
  useEffect(() => {
    if (isWarning) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(warningAnim, { toValue: 1, duration: 300, useNativeDriver: true }),
          Animated.timing(warningAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
        ])
      ).start();
    } else {
      warningAnim.stopAnimation();
      warningAnim.setValue(0);
    }
  }, [isWarning]);

  const startDetection = () => {
    setRunning(true);
    setIsWarning(false);
    setStatus('Scanning environment...');
    speak('Detection started. Scanning your environment.');

    intervalRef.current = setInterval(async () => {
      try {
        if (!cameraRef.current) return;
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.3 });
        if (!photo) return;

        const formData = new FormData();
        formData.append('file', { uri: photo.uri, type: 'image/jpeg', name: 'frame.jpg' } as any);

        const res = await fetch(`${BACKEND}/detect`, { method: 'POST', body: formData });
        const { text, warning } = await res.json();

        setStatus(text);
        setIsWarning(warning);

        if (warning) {
          await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
          speakWarning(text);
        } else {
          speak(text);
        }
      } catch (e) {
        const errMsg = 'Cannot reach server. Please check your connection.';
        setStatus('❌ ' + errMsg);
        setIsWarning(false);
        speak(errMsg);
      }
    }, 3500); // slightly longer interval for calmer experience
  };

  const stopDetection = () => {
    clearInterval(intervalRef.current);
    setRunning(false);
    setIsWarning(false);
    setStatus('Tap anywhere to start');
    speak('Detection stopped. Tap anywhere to start again.');
  };

  // Toggle on tap anywhere
  const handleScreenTap = () => {
    if (running) {
      stopDetection();
    } else {
      startDetection();
    }
  };

  useEffect(() => {
    return () => clearInterval(intervalRef.current);
  }, []);

  // Permission screen
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
        <Text style={styles.permissionSub}>
          Tap anywhere to allow camera access
        </Text>
      </TouchableOpacity>
    );
  }

  return (
    // Entire screen is tappable — blind user just taps anywhere
    <TouchableOpacity
      style={styles.container}
      onPress={handleScreenTap}
      activeOpacity={1}
    >
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />

      {/* Warning red flash overlay */}
      <Animated.View
        style={[styles.warningOverlay, {
          opacity: warningAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.25] })
        }]}
        pointerEvents="none"
      />

      {/* Top bar */}
      <View style={styles.topBar}>
        <Text style={styles.topBarTitle}>👁️ Virtual Eye</Text>
        <View style={[styles.liveDot, running && styles.liveDotActive]} />
      </View>

      {/* Bottom panel */}
      <View style={styles.overlay}>

        {/* Status box */}
        <View style={[styles.statusBox, isWarning && styles.statusBoxWarning]}>
          <Text style={styles.statusIcon}>
            {isWarning ? '⚠️' : running ? '🔍' : '💤'}
          </Text>
          <Text style={[styles.statusText, isWarning && styles.statusTextWarning]}>
            {status}
          </Text>
        </View>

        {/* Big tap button with pulse */}
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

  // Permission
  permissionContainer: {
    flex: 1, backgroundColor: '#0a0a0a',
    justifyContent: 'center', alignItems: 'center', padding: 32
  },
  permissionIcon: { fontSize: 60, marginBottom: 16 },
  permissionTitle: { color: '#fff', fontSize: 22, fontWeight: 'bold', marginBottom: 10 },
  permissionSub: { color: '#aaa', fontSize: 14, textAlign: 'center' },

  // Camera
  camera: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  // Warning overlay
  warningOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: '#ff0000', zIndex: 1
  },

  // Top bar
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.6)', paddingTop: 48, paddingBottom: 12,
    paddingHorizontal: 24, zIndex: 2
  },
  topBarTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  liveDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#555' },
  liveDotActive: { backgroundColor: '#4caf50' },

  // Bottom overlay
  overlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.85)',
    padding: 24, alignItems: 'center',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    zIndex: 2
  },

  // Status box
  statusBox: {
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderRadius: 16, paddingVertical: 16, paddingHorizontal: 20,
    marginBottom: 20, width: '100%', minHeight: 90,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)'
  },
  statusBoxWarning: {
    backgroundColor: 'rgba(255,60,60,0.15)',
    borderColor: 'rgba(255,60,60,0.4)'
  },
  statusIcon: { fontSize: 24, marginBottom: 8 },
  statusText: { color: '#4fc3f7', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  statusTextWarning: { color: '#ff6b6b', fontWeight: '700', fontSize: 16 },

  // Buttons
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