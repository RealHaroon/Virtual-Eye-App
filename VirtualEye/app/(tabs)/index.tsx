import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import { useRef, useEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, StatusBar } from 'react-native';

// const BACKEND = 'http://192.168.100.15:8000';
const BACKEND = 'http://192.168.43.160:8000';


export default function HomeScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [status, setStatus] = useState('Press Start to begin');
  const [running, setRunning] = useState(false);
  const cameraRef = useRef<CameraView>(null);
  const intervalRef = useRef<any>(null);

  const startDetection = () => {
    setRunning(true);
    setStatus('Listening...');
    intervalRef.current = setInterval(async () => {
      try {
        if (!cameraRef.current) return;
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.3 });
        if (!photo) return;

        const formData = new FormData();
        formData.append('file', { uri: photo.uri, type: 'image/jpeg', name: 'frame.jpg' } as any);

        const res = await fetch(`${BACKEND}/detect`, { method: 'POST', body: formData });
        const { text } = await res.json();

        setStatus(text);
        Speech.speak(text, { language: 'en', rate: 0.85 });
      } catch (e) {
        setStatus('❌ Cannot reach backend. Check WiFi & IP.');
      }
    }, 3000);
  };

  const stopDetection = () => {
    clearInterval(intervalRef.current);
    setRunning(false);
    setStatus('Press Start to begin');
    Speech.stop();
  };

  useEffect(() => {
    return () => clearInterval(intervalRef.current);
  }, []);

  if (!permission) return <View style={styles.container} />;

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={styles.title}>👁️ Virtual Eye</Text>
        <Text style={styles.subtitle}>Camera access is required</Text>
        <TouchableOpacity onPress={requestPermission} style={styles.btnStart}>
          <Text style={styles.btnText}>Allow Camera</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />
      <CameraView ref={cameraRef} style={styles.camera} facing="back" />

      <View style={styles.overlay}>
        <Text style={styles.title}>👁️ Virtual Eye</Text>
        <Text style={styles.subtitle}>AI Assistant for the Visually Impaired</Text>

        <View style={styles.statusBox}>
          <Text style={styles.statusText}>{status}</Text>
        </View>

        <TouchableOpacity
          style={running ? styles.btnStop : styles.btnStart}
          onPress={running ? stopDetection : startDetection}
        >
          <Text style={styles.btnText}>{running ? '⏹  Stop' : '▶  Start'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#000',
    justifyContent: 'center',
    alignItems: 'center',
  },
  camera: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
  },
  overlay: {
    position: 'absolute',
    bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(0,0,0,0.82)',
    padding: 28,
    alignItems: 'center',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  title: {
    color: '#ffffff',
    fontSize: 26,
    fontWeight: 'bold',
    marginBottom: 4,
  },
  subtitle: {
    color: '#aaaaaa',
    fontSize: 13,
    marginBottom: 20,
  },
  statusBox: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 24,
    width: '100%',
    minHeight: 60,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statusText: {
    color: '#4fc3f7',
    fontSize: 16,
    textAlign: 'center',
  },
  btnStart: {
    backgroundColor: '#01696f',
    paddingVertical: 16,
    paddingHorizontal: 60,
    borderRadius: 30,
    width: '100%',
    alignItems: 'center',
  },
  btnStop: {
    backgroundColor: '#a12c7b',
    paddingVertical: 16,
    paddingHorizontal: 60,
    borderRadius: 30,
    width: '100%',
    alignItems: 'center',
  },
  btnText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
});