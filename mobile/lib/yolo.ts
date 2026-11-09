// Turns the raw output tensor of a YOLOv8 TFLite model into detected objects.
// Pure logic with no React Native imports, so it can be unit tested with Node.

import type { DetectedObject, Position } from './announcer.ts';

// The 80 COCO classes YOLOv8 is trained on, in model output order.
export const COCO_LABELS = [
  'person', 'bicycle', 'car', 'motorcycle', 'airplane', 'bus', 'train', 'truck', 'boat',
  'traffic light', 'fire hydrant', 'stop sign', 'parking meter', 'bench', 'bird', 'cat', 'dog',
  'horse', 'sheep', 'cow', 'elephant', 'bear', 'zebra', 'giraffe', 'backpack', 'umbrella',
  'handbag', 'tie', 'suitcase', 'frisbee', 'skis', 'snowboard', 'sports ball', 'kite',
  'baseball bat', 'baseball glove', 'skateboard', 'surfboard', 'tennis racket', 'bottle',
  'wine glass', 'cup', 'fork', 'knife', 'spoon', 'bowl', 'banana', 'apple', 'sandwich', 'orange',
  'broccoli', 'carrot', 'hot dog', 'pizza', 'donut', 'cake', 'chair', 'couch', 'potted plant',
  'bed', 'dining table', 'toilet', 'tv', 'laptop', 'mouse', 'remote', 'keyboard', 'cell phone',
  'microwave', 'oven', 'toaster', 'sink', 'refrigerator', 'book', 'clock', 'vase', 'scissors',
  'teddy bear', 'hair drier', 'toothbrush',
];

/** Box corners as fractions of the frame (0..1). */
export type Box = { x1: number; y1: number; x2: number; y2: number };

export type YoloDetection = { classId: number; label: string; confidence: number; box: Box };

export type DecodeOptions = {
  /** Output tensor shape, e.g. [1, 84, 2100] (ultralytics export) or [1, 2100, 84]. */
  shape: number[];
  /** Model input size in pixels; only used if box coordinates come out in pixels. */
  inputSize: number;
  confThreshold?: number;
  iouThreshold?: number;
  maxDetections?: number;
  labels?: string[];
};

function iou(a: Box, b: Box): number {
  const ix = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1));
  const iy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  const inter = ix * iy;
  const union = (a.x2 - a.x1) * (a.y2 - a.y1) + (b.x2 - b.x1) * (b.y2 - b.y1) - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Decodes YOLOv8 output: for each candidate box, 4 values (center x, center y,
 * width, height) followed by one score per class. Keeps the best class per box,
 * drops low scores, then removes overlapping boxes of the same class (NMS).
 */
export function decodeYolo(output: Float32Array, opts: DecodeOptions): YoloDetection[] {
  const {
    shape, inputSize, confThreshold = 0.35, iouThreshold = 0.45,
    maxDetections = 50, labels = COCO_LABELS,
  } = opts;

  const [, dimA, dimB] = shape;
  // Find the channel axis (4 box values + one score per class); the other axis
  // is the candidate count. If neither matches the label list (a custom
  // model), assume the smaller axis is channels.
  const expectedChannels = 4 + labels.length;
  const channelsFirst = dimA === expectedChannels || (dimB !== expectedChannels && dimA < dimB);
  const channels = channelsFirst ? dimA : dimB;
  const count = channelsFirst ? dimB : dimA;
  const numClasses = channels - 4;
  const at = channelsFirst
    ? (c: number, i: number) => output[c * count + i]
    : (c: number, i: number) => output[i * channels + c];

  const candidates: YoloDetection[] = [];
  let maxCoord = 0;
  for (let i = 0; i < count; i++) {
    let best = -1;
    let bestScore = confThreshold;
    for (let c = 0; c < numClasses; c++) {
      const score = at(4 + c, i);
      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }
    if (best < 0) continue;
    const cx = at(0, i), cy = at(1, i), w = at(2, i), h = at(3, i);
    maxCoord = Math.max(maxCoord, cx, cy);
    candidates.push({
      classId: best,
      label: labels[best] ?? `object ${best}`,
      confidence: bestScore,
      box: { x1: cx - w / 2, y1: cy - h / 2, x2: cx + w / 2, y2: cy + h / 2 },
    });
  }

  // Some exports give pixel coordinates instead of 0..1 fractions.
  if (maxCoord > 2) {
    for (const d of candidates) {
      d.box = {
        x1: d.box.x1 / inputSize, y1: d.box.y1 / inputSize,
        x2: d.box.x2 / inputSize, y2: d.box.y2 / inputSize,
      };
    }
  }
  for (const d of candidates) {
    d.box = {
      x1: Math.max(0, d.box.x1), y1: Math.max(0, d.box.y1),
      x2: Math.min(1, d.box.x2), y2: Math.min(1, d.box.y2),
    };
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  const kept: YoloDetection[] = [];
  for (const cand of candidates) {
    if (kept.length >= maxDetections) break;
    const overlaps = kept.some(k => k.classId === cand.classId && iou(k.box, cand.box) > iouThreshold);
    if (!overlaps) kept.push(cand);
  }
  return kept;
}

export type InputLayout = {
  width: number;
  height: number;
  /** 'nchw' = [1, 3, H, W] (LiteRT export from PyTorch), 'nhwc' = [1, H, W, 3] (TensorFlow export). */
  layout: 'nchw' | 'nhwc';
};

/** Reads the image size and channel order from the model's input shape. */
export function inputLayoutOf(shape: number[]): InputLayout {
  const [, a, b, c] = shape;
  if (a === 3 && c !== 3) return { layout: 'nchw', height: b, width: c };
  if (c === 3) return { layout: 'nhwc', height: a, width: b };
  throw new Error(`Unsupported model input shape [${shape.join(', ')}]`);
}

/**
 * Converts interleaved RGB bytes (r,g,b,r,g,b,...) into the model's input
 * tensor: floats 0..1 (or raw bytes for uint8 models) in the model's channel order.
 */
export function toInputTensor(rgb: Uint8Array, input: InputLayout, dataType: string): ArrayBuffer {
  const pixels = input.width * input.height;
  if (rgb.length !== pixels * 3) {
    throw new Error(`Expected ${pixels * 3} RGB bytes, got ${rgb.length}`);
  }
  const out = dataType === 'uint8' ? new Uint8Array(pixels * 3) : new Float32Array(pixels * 3);
  const scale = dataType === 'uint8' ? 1 : 1 / 255;
  if (input.layout === 'nhwc') {
    for (let i = 0; i < rgb.length; i++) out[i] = rgb[i] * scale;
  } else {
    for (let p = 0; p < pixels; p++) {
      out[p] = rgb[p * 3] * scale;                  // R plane
      out[pixels + p] = rgb[p * 3 + 1] * scale;     // G plane
      out[2 * pixels + p] = rgb[p * 3 + 2] * scale; // B plane
    }
  }
  return out.buffer as ArrayBuffer;
}

/** Same left / center / right split as the server. */
export function positionOf(box: Box): Position {
  const center = (box.x1 + box.x2) / 2;
  if (center < 0.35) return 'left';
  if (center > 0.65) return 'right';
  return 'center';
}

export function toDetectedObject(d: YoloDetection): DetectedObject {
  return {
    label: d.label,
    position: positionOf(d.box),
    area: (d.box.x2 - d.box.x1) * (d.box.y2 - d.box.y1),
    confidence: d.confidence,
  };
}
