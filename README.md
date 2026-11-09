# 👁️ Virtual Eye

An AI assistant that helps blind and visually impaired people understand their surroundings.
Point the phone's camera ahead: Virtual Eye detects objects, says **where** they are
(left / ahead / right), warns about **close obstacles** with vibration, and **reads text** aloud.

## Features

- **Object detection** with YOLOv8, described in natural speech ("I notice a chair on your left")
- **Obstacle warnings**: a large object close by triggers a haptic alert and an urgent voice warning
- **Text reading (OCR)** with EasyOCR
- **Tap anywhere** to start or stop, so you don't need to find a button
- **Auto flashlight** that switches on in the dark using the light sensor (Android)
- Speech-paced loop: the next frame is only captured after the current description finishes

## Architecture

```
┌──────────────┐   JPEG frame (HTTP POST /detect)   ┌───────────────────────┐
│  mobile/     │ ─────────────────────────────────▶ │  server/              │
│  Expo app    │                                     │  FastAPI              │
│  camera, TTS │ ◀───────────────────────────────── │  YOLOv8m + EasyOCR    │
│  haptics     │   { text, warning }                 │                       │
└──────────────┘                                     └───────────────────────┘
```

## Project structure

| Folder    | What it is                                                     |
|-----------|----------------------------------------------------------------|
| `mobile/` | React Native / Expo app (expo-camera, expo-speech, expo-haptics) |
| `server/` | Python FastAPI backend with YOLOv8 object detection and EasyOCR |

## Getting started

### 1. Run the server

```bash
cd server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Or with Docker: `docker compose up --build`.
YOLO weights and the OCR model download automatically on first run.

### 2. Point the app at your server

Find your computer's local IP address (`ip a` / `ipconfig`) and set it in
`mobile/app/index.tsx`:

```ts
const BACKEND = 'http://<your-ip>:8000';
```

The phone and the computer must be on the same Wi-Fi network.

### 3. Run the app

```bash
cd mobile
npm install
npx expo start          # development
eas build -p android --profile preview   # build an installable APK
```

## Roadmap

- [ ] On-device detection (works offline, without a server)
- [ ] Distance estimation
- [ ] Only announce changes in the scene, most important first
- [ ] Currency recognition
- [ ] Urdu voice output
- [ ] Voice commands and an SOS gesture

## License

See [LICENSE](LICENSE).
