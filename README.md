# 👁️ Virtual Eye

An AI assistant that helps blind and visually impaired people understand their surroundings.
Point the phone's camera ahead: Virtual Eye detects objects, says **where** they are
(left / ahead / right), warns about **close obstacles** with vibration, and **reads text** aloud.

## Features

- **Works offline**: YOLOv8 runs on the phone with TensorFlow Lite, no server needed
- **Optional server mode** for a bigger model and text reading, with automatic fallback to
  on-device detection when the server can't be reached
- **Object detection** described in short phrases ("Chair on the left, near")
- **Only speaks when something changes**: new objects, objects getting closer, or new text.
  Most important first: very close objects, then vehicles, people and animals, then obstacles.
  After a long silence it gives a short "Path clear" / "Still around you" update
- **Obstacle warnings**: a large object close by triggers a haptic alert and an urgent voice warning
- **Text reading (OCR)** with EasyOCR (server mode)
- **Tap anywhere** to start or stop, so you don't need to find a button
- **Auto flashlight** that switches on in the dark using the light sensor (Android)
- Speech-paced loop: the next frame is only captured after the current description finishes

## Architecture

```
            ┌─────────────────────── mobile/ (Expo app) ───────────────────────┐
 camera ──▶ │ photo ─▶ on-device YOLOv8 (TFLite) ─┐                            │
            │      └─▶ server (optional) ─────────┴─▶ announcer ─▶ speech,     │
            │                                         (what changed?)  haptics │
            └──────────────────────────────────────────────────────────────────┘
                         │ HTTP POST /detect (only if EXPO_PUBLIC_BACKEND_URL is set)
                         ▼
            ┌──────────── server/ ────────────┐
            │ FastAPI · YOLOv8m · EasyOCR      │
            │ → { objects, ocr, text, warning }│
            └──────────────────────────────────┘
```

## Project structure

| Folder    | What it is                                                     |
|-----------|----------------------------------------------------------------|
| `mobile/` | React Native / Expo app (expo-camera, expo-speech, expo-haptics) |
| `server/` | Python FastAPI backend with YOLOv8 object detection and EasyOCR |

## Getting started

### 1. Add the on-device model

Follow [`mobile/assets/models/README.md`](mobile/assets/models/README.md) to export
`yolov8n.tflite` (about 12 MB, made in Google Colab; already included in this repo) and put it in `mobile/assets/models/`.

### 2. (Optional) Run the server

Only needed for text reading or a bigger model. Skip it to run fully on the phone.

```bash
cd server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Or with Docker: `docker compose up --build`.
YOLO weights and the OCR model download automatically on first run.
Choose a model size with `YOLO_MODEL` (default `yolov8m.pt`; `yolov8s.pt` is faster on a CPU):
`YOLO_MODEL=yolov8s.pt uvicorn main:app --host 0.0.0.0 --port 8000`

Then point the app at it:

Find your computer's local IP address (`ip a` / `ipconfig`), then:

```bash
cd mobile
cp .env.example .env.local
# edit .env.local: EXPO_PUBLIC_BACKEND_URL=http://<your-ip>:8000
```

The phone and the computer must be on the same Wi-Fi network.

### 3. Build and run the app

The app uses native modules (TensorFlow Lite), so it does **not** run in Expo Go.
Build it with EAS (in the cloud, no large local downloads):

```bash
cd mobile
npm install
eas build -p android --profile preview       # installable APK
# or, for live reloading while developing:
eas build -p android --profile development   # install once, then: npx expo start --dev-client
```

## Roadmap

- [x] On-device detection (works offline, without a server)
- [ ] Distance estimation
- [x] Only announce changes in the scene, most important first
- [ ] Currency recognition
- [ ] Urdu voice output
- [ ] Voice commands and an SOS gesture

## Tests

```bash
cd mobile && npm test     # announcer + YOLO decoding (Node's built-in test runner)
```

## License

See [LICENSE](LICENSE).
