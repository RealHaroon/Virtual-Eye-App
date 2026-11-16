// Runs YOLOv8 on the phone with TensorFlow Lite, so detection works offline.
//
// Pipeline per photo: shrink to the model's input size -> decode JPEG to RGB
// pixels -> run the model -> decode boxes (lib/yolo.ts).

import { loadTensorflowModel, type TfliteModel } from 'react-native-fast-tflite';
import { loadRgb } from './imagePixels';
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

export async function detectOnDevice(photoUri: string): Promise<DetectedObject[]> {
  const model = await loadDetector();
  const input = inputLayoutOf(model.inputs[0].shape); // [1, 3, H, W] or [1, H, W, 3]
  const { width, height } = input;

  // Stretching the photo to the model's square input keeps box positions and
  // sizes as fractions of the original frame.
  const rgb = await loadRgb(photoUri, width, height);
  const [output] = await model.run([toInputTensor(rgb, input, model.inputs[0].dataType)]);
  const detections = decodeYolo(new Float32Array(output), {
    shape: model.outputs[0].shape,
    inputSize: width,
  });
  return detections.map(toDetectedObject);
}
