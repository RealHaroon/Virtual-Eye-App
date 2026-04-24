import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import * as Haptics from 'expo-haptics';
import { useRef, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  StatusBar, Animated, Dimensions
} from 'react-native';

const BACKEND = 'http://192.168.100.15:8000';


// const BACKEND = 'http://192.168.43.160:8000';
// const BACKEND = 'http://10.182.192.81:8000';


const { width } = Dimensions.get('window');

export default function HomeScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState('Press Start to begin');
  const [running, setRunning] = useState(false);
  const [isWarning, setIsWarning] = useState(false);
  const [started, setStarted] = useState(false); // splash control

  const cameraRef = useRef<CameraView>(null);
  const intervalRef = useRef<any>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const warningAnim = useRef(new Animated.Value(0)).current;
  const splashAnim = useRef(new Animated.Value(0)).current;

  // Splash fade in
  useEffect(() => {
    Animated.timing(splashAnim, {
      toValue: 1,
      duration: 800,
      useNativeDriver: true,
    }).start();
  }, []);

  // Pulse animation when running
  useEffect(() => {
    if (running) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.15, duration: 800, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
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
    setStatus('Scanning environment...');
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
        }

        Speech.speak(text, { language: 'en', rate: warning ? 1.1 : 0.85 });
      } catch (e) {
        setStatus('❌ Cannot reach backend. Check WiFi & IP.');
        setIsWarning(false);
      }
    }, 3000);
  };

  const stopDetection = () => {
    clearInterval(intervalRef.current);
    setRunning(false);
    setIsWarning(false);
    setStatus('Press Start to begin');
    Speech.stop();
  };

  useEffect(() => {
    return () => clearInterval(intervalRef.current);
  }, []);

  // Permission screen
  if (!permission) return <View style={styles.container} />;
  if (!permission.granted) {
    return (
      <View style={styles.permissionContainer}>
        <Text style={styles.permissionIcon}>📷</Text>
        <Text style={styles.permissionTitle}>Camera Access Needed</Text>
        <Text style={styles.permissionSub}>Virtual Eye needs your camera to detect objects and guide you</Text>
        <TouchableOpacity onPress={requestPermission} style={styles.btnStart}>
          <Text style={styles.btnText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Splash / intro screen
  if (!started) {
    return (
      <Animated.View style={[styles.splashContainer, { opacity: splashAnim }]}>
        <Text style={styles.splashIcon}>👁️</Text>
        <Text style={styles.splashTitle}>Virtual Eye</Text>
        <Text style={styles.splashSubtitle}>AI Assistant for the{'\n'}Visually Impaired</Text>
        <View style={styles.splashDivider} />
        <Text style={styles.splashDesc}>
          Point your camera at the environment.{'\n'}
          The app will detect objects and{'\n'}
          guide you using voice commands.
        </Text>
        <TouchableOpacity
          style={styles.btnStart}
          onPress={() => setStarted(true)}
        >
          <Text style={styles.btnText}>Get Started →</Text>
        </TouchableOpacity>
      </Animated.View>
    );
  }

  // Main camera screen
  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />

      {/* Warning red flash */}
      <Animated.View
        style={[styles.warningOverlay, {
          opacity: warningAnim.interpolate({ inputRange: [0, 1], outputRange: [0, 0.3] })
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
          <Text style={styles.statusIcon}>{isWarning ? '⚠️' : running ? '🔍' : '💤'}</Text>
          <Text style={[styles.statusText, isWarning && styles.statusTextWarning]}>
            {status}
          </Text>
        </View>

        {/* Start / Stop button with pulse */}
        <Animated.View style={{ transform: [{ scale: pulseAnim }], width: '100%' }}>
          <TouchableOpacity
            style={running ? styles.btnStop : styles.btnStart}
            onPress={running ? stopDetection : startDetection}
            activeOpacity={0.85}
          >
            <Text style={styles.btnText}>{running ? '⏹  Stop Detection' : '▶  Start Detection'}</Text>
          </TouchableOpacity>
        </Animated.View>

        <Text style={styles.hint}>
          {running ? 'Detecting every 3 seconds...' : 'Tap Start to begin scanning'}
        </Text>
      </View>
    </View>
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
  permissionSub: { color: '#aaa', fontSize: 14, textAlign: 'center', marginBottom: 32 },

  // Splash
  splashContainer: {
    flex: 1, backgroundColor: '#0a0a0a',
    justifyContent: 'center', alignItems: 'center', padding: 32
  },
  splashIcon: { fontSize: 72, marginBottom: 16 },
  splashTitle: { color: '#fff', fontSize: 36, fontWeight: 'bold', marginBottom: 8 },
  splashSubtitle: { color: '#4fc3f7', fontSize: 16, textAlign: 'center', marginBottom: 24 },
  splashDivider: {
    width: 48, height: 2, backgroundColor: '#01696f',
    borderRadius: 2, marginBottom: 24
  },
  splashDesc: {
    color: '#888', fontSize: 14, textAlign: 'center',
    lineHeight: 22, marginBottom: 40
  },

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
  liveDot: {
    width: 10, height: 10, borderRadius: 5, backgroundColor: '#555'
  },
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
    marginBottom: 20, width: '100%', minHeight: 80,
    justifyContent: 'center', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)'
  },
  statusBoxWarning: {
    backgroundColor: 'rgba(255,60,60,0.15)',
    borderColor: 'rgba(255,60,60,0.4)'
  },
  statusIcon: { fontSize: 22, marginBottom: 6 },
  statusText: { color: '#4fc3f7', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  statusTextWarning: { color: '#ff6b6b', fontWeight: '700', fontSize: 16 },

  // Buttons
  btnStart: {
    backgroundColor: '#01696f', paddingVertical: 16,
    borderRadius: 30, width: '100%', alignItems: 'center',
    shadowColor: '#01696f', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8
  },
  btnStop: {
    backgroundColor: '#a12c7b', paddingVertical: 16,
    borderRadius: 30, width: '100%', alignItems: 'center',
    shadowColor: '#a12c7b', shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8
  },
  btnText: { color: '#fff', fontSize: 18, fontWeight: '700' },
  hint: { color: '#555', fontSize: 12, marginTop: 12 },
});