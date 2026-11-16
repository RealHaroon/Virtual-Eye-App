# 👁️ Virtual Eye

[![CI](https://github.com/RealHaroon/Virtual-Eye-App/actions/workflows/ci.yml/badge.svg)](https://github.com/RealHaroon/Virtual-Eye-App/actions/workflows/ci.yml)
![Platform](https://img.shields.io/badge/platform-Android-3DDC84)
![Expo SDK](https://img.shields.io/badge/Expo%20SDK-54-000020)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**An AI assistant that helps blind and visually impaired people understand their surroundings.**

Hold the phone in front of you and Virtual Eye tells you what's around: *"Careful! Car
ahead, very close."* It detects objects, says where they are, warns about obstacles with
vibration, reads signs and labels, names colours and checks the light — **all on the
phone, with no internet needed**, in **English or Urdu (اردو)**.

Created by **M Haroon Abbas** ([@RealHaroon](https://github.com/RealHaroon)).

---

## Contents

- [Features](#features)
- [How to use the app](#how-to-use-the-app)
- [Build the APK yourself](#build-the-apk-yourself)
- [Optional: run the server](#optional-run-the-server)
- [How it works](#how-it-works)
- [Project structure](#project-structure)
- [Development](#development)
- [Roadmap](#roadmap)
- [Author](#author)

## Features

- **Works offline**: YOLOv8 object detection runs on the phone with TensorFlow Lite
- **Speaks only what changed**: new objects, things getting closer, or new text, most
  important first (very close objects, then vehicles, people and animals, then obstacles)
- **Obstacle warnings** with vibration and an urgent voice
- **Four modes**, switched by swiping:
  - **Scan**: objects around you and where they are ("Chair on the left, near")
  - **Read text**: signs, labels and documents (Google ML Kit, on the phone)
  - **Colour**: the colour of what the camera points at ("Mostly dark blue, with some white")
  - **Light**: how bright it is ("Very dark. The lights are probably off.")
- **English and Urdu** voice, chosen in Settings
- **Built for screen readers**: every control works with TalkBack
- **Settings**: language, speech speed, and how much to say (quiet / normal / detailed)
- **Spoken tutorial** on first launch
- **Auto flashlight** in the dark, using the light sensor
- **Battery saver**: pauses while the phone lies face down
- **Optional server mode** with a bigger model, falling back to the phone automatically

## How to use the app

The whole screen is one big button, so there's nothing to find.

| Gesture | Scan / Read text mode | Colour / Light mode |
|---|---|---|
| **Tap** | Start or stop | Check now |
| **Double-tap** | Describe everything in view now | Check now |
| **Touch and hold** | Repeat the last message | Repeat the last message |
| **Swipe left / right** | Change mode | Change mode |

The **⚙️ Settings** and **🔦 flashlight** buttons are in the top-right corner.

**With TalkBack on**, TalkBack uses its own gestures. Double-tap to start or stop; the other
actions (describe now, repeat, next / previous mode) are in TalkBack's **actions menu**.

**Urdu voice:** choose *اردو* in Settings. If the phone has no Urdu voice, the app tells you
how to install it: phone **Settings → Text-to-speech → Google → Install voice data → Urdu**.

## Build the APK yourself

The app is built with [Expo](https://expo.dev) and **EAS Build**, which compiles the APK
on Expo's servers. Your computer only uploads the project (about 22 MB), so you don't need
Android Studio or a fast internet connection. A free Expo account is enough.

> The app uses native modules (TensorFlow Lite, ML Kit), so it does **not** run in the
> Expo Go app. You need to build an APK.

### What you need

- [Node.js](https://nodejs.org) 24 (22.18 or newer also works) and Git
- A free account at [expo.dev](https://expo.dev/signup)
- An Android phone

### Step 1: Get the code

```bash
git clone https://github.com/RealHaroon/Virtual-Eye-App.git
cd Virtual-Eye-App/mobile
npm install
```

The detection model (`mobile/assets/models/yolov8n.tflite`, 12 MB) is already in the
repo. To make your own, see [`mobile/assets/models/README.md`](mobile/assets/models/README.md).

### Step 2: Install EAS and log in

```bash
npm install -g eas-cli
eas login
```

If `eas login` can't show a prompt (some terminals and editors), use the browser instead:
`eas login --device` prints a link and a code to approve on expo.dev.

### Step 3 (only if you are not the project owner): link it to your account

`app.json` is linked to the owner's Expo project. To build under **your own** account:

1. In `mobile/app.json`, delete the `"eas": { "projectId": "..." }` entry under `"extra"`.
2. Change `"android.package"` to something unique to you, for example
   `"com.yourname.virtualeye"`.
3. Run `eas init` and let it create a new project for you.

### Step 4: Build

```bash
eas build -p android --profile preview
```

- The first time, EAS asks to **generate an Android keystore**: answer **yes**. EAS keeps it
  safe for you; it's what lets new versions install over old ones.
- The build waits in a queue and then takes about 10–20 minutes on the free plan. You can
  close the terminal; the build carries on. Follow it on
  [expo.dev](https://expo.dev) → your project → **Builds**.
- To only queue the build and get the link straight away, add `--no-wait`.

> **Only committed files are built.** If you changed something, `git commit` it first.

### Step 5: Install on the phone

When the build finishes, its page on expo.dev shows a **download link and a QR code**.
Open it on the phone, download the `.apk` and open it. Android will ask you to allow
installing apps from your browser or file manager: allow it once.

### Other build options

| Option | Command | When to use |
|---|---|---|
| Development build | `eas build -p android --profile development`, then `npx expo start --dev-client` | Live reloading while you change the code |
| Build on your own computer | `eas build -p android --profile preview --local` | No queue, but needs Android SDK + NDK and downloads over 1 GB the first time |
| Play Store bundle | `eas build -p android --profile production` | An `.aab` for Google Play |

### Troubleshooting

| Problem | Fix |
|---|---|
| `eas: command not found` | `npm install -g eas-cli` |
| `account:login command failed` | Use `eas login --device` |
| "Project not found" / permission error | You're building someone else's project: see Step 3 |
| App installs but can't reach the server | Only matters in server mode: phone and computer must be on the same Wi-Fi, and the IP in `.env.local` must be right |
| No Urdu voice | Install it: phone Settings → Text-to-speech → Google → Install voice data |

## Optional: run the server

Not needed: the app works fully on the phone. The server gives a bigger model
(YOLOv8m) and EasyOCR.

```bash
cd server
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

Or with Docker: `docker compose up --build`. Model weights download on first run.
Pick a model size with `YOLO_MODEL` (default `yolov8m.pt`; `yolov8s.pt` is faster on a CPU).

Then point the app at it **before building**:

```bash
cd mobile
cp .env.example .env.local
# edit .env.local: EXPO_PUBLIC_BACKEND_URL=http://<your-computer's-ip>:8000
```

If the server can't be reached, the app says so and keeps working on the phone.

## How it works

```
            ┌─────────────────────── mobile/ (Expo app) ───────────────────────┐
 camera ──▶ │ photo ─▶ on-device YOLOv8 (TFLite) + ML Kit OCR ─┐               │
            │      └─▶ server (optional) ──────────────────────┴─▶ announcer ─▶│─▶ speech
            │                                                (what changed?)   │   haptics
            └──────────────────────────────────────────────────────────────────┘
                         │ HTTP POST /detect (only if EXPO_PUBLIC_BACKEND_URL is set)
                         ▼
            ┌──────────── server/ ────────────┐
            │ FastAPI · YOLOv8m · EasyOCR      │
            └──────────────────────────────────┘
```

1. About once a second the app takes a photo (no shutter sound).
2. **YOLOv8n** (TensorFlow Lite) finds objects; **ML Kit** reads text.
3. The **announcer** compares with what it already said and decides what's worth saying,
   most important first.
4. The phone speaks it in the chosen language, with vibration for warnings.

## Project structure

| Path | What it is |
|---|---|
| `mobile/app/` | Screens: camera (`index.tsx`) and settings |
| `mobile/lib/` | Detection, announcer, translations, colour/light, gestures, settings |
| `mobile/lib/*.test.ts` | Unit tests |
| `mobile/assets/models/` | The on-device YOLOv8n model |
| `server/` | Optional FastAPI backend |
| `AGENTS.md` | Detailed notes for contributors and AI coding assistants |

## Development

```bash
cd mobile
npm test             # unit tests (Node's built-in test runner)
npm run typecheck    # TypeScript
npm run lint         # ESLint
```

GitHub Actions runs all three on every push. See [`AGENTS.md`](AGENTS.md) for the
architecture, design decisions and known gotchas.

## Roadmap

- [x] On-device object detection and text reading (works offline)
- [x] Speaks only what changed, most important first
- [x] Urdu voice
- [x] Modes: Scan, Read text, Colour, Light
- [ ] Urdu on-screen text and reading Urdu script
- [ ] Pakistani currency (PKR) recognition
- [ ] SOS: send your location to a trusted contact
- [ ] Real distance in metres
- [ ] Optional AI scene descriptions

## Author

**M Haroon Abbas**: [@RealHaroon](https://github.com/RealHaroon) on GitHub.

Suggestions, bug reports and pull requests are welcome. If you are blind or visually
impaired and try the app, your feedback is especially valuable.

## License

[MIT](LICENSE) © 2026 M Haroon Abbas
