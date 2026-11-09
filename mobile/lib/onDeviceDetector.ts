// Runs YOLOv8 on the phone with TensorFlow Lite, so detection works offline.
//
// Pipeline per photo: shrink to the model's input size -> decode JPEG to RGB
// pixels -> run the model -> decode boxes (lib/yolo.ts).

import { loadTensorflowModel, type TfliteModel } from 'react-native-fast-tflite';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { File } from 'expo-file-system';
import * as jpeg from 'jpeg-js';
import { decodeYolo, inputLayoutOf, toDetectedObject, toInputTensor } from './yolo';
import type { DetectedObject } from './announcer';

// Exported from ultralytics in Google Colab, see assets/models/README.md.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const MODEL_ASSET = require('../assets/models/yolov8n.tflite');

let modelPromise: Promise<TfliteModel> | null = null;

/** Loads the model once (GPU if the phone supports it, otherwise CPU). Safe to call repeatedly. */
export function loadDetector(): Promise<TfliteModel> {
  if (!modelPromise) {
    modelPromise = loadTensorflowModel(MODEL_ASSET, ['android-gpu'])
      .catch(() => loadTensorflowModel(MODEL_ASSET, []))
      .catch((error) => {
        modelPromise = null; // allow a retry next time
        throw error;
      });
  }
  return modelPromise;
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function detectOnDevice(photoUri: string): Promise<DetectedObject[]> {
  const model = await loadDetector();
  const input = inputLayoutOf(model.inputs[0].shape); // [1, 3, H, W] or [1, H, W, 3]
  const { width, height } = input;

  // Giving both width and height stretches the photo to the model's square input.
  // Box positions and sizes then come out as fractions of the original frame.
  const resized = await manipulateAsync(
    photoUri,
    [{ resize: { width, height } }],
    { format: SaveFormat.JPEG, compress: 0.9, base64: true },
  );
  try {
    if (!resized.base64) throw new Error('Image resize returned no data');
    const { data } = jpeg.decode(base64ToBytes(resized.base64), { useTArray: true, formatAsRGBA: false });

    const [output] = await model.run([toInputTensor(data, input, model.inputs[0].dataType)]);
    const detections = decodeYolo(new Float32Array(output), {
      shape: model.outputs[0].shape,
      inputSize: width,
    });
    return detections.map(toDetectedObject);
  } finally {
    try {
      new File(resized.uri).delete();
    } catch {
      // cache file already gone
    }
  }
}
