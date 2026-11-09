import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeYolo, inputLayoutOf, toDetectedObject, toInputTensor } from './yolo.ts';

// Builds a fake YOLOv8 output in the ultralytics TFLite layout [1, 4 + classes, N]:
// normalized center x, center y, width, height, then one score per class.
function fakeOutput(boxes: { cx: number; cy: number; w: number; h: number; cls: number; score: number }[], numClasses = 80) {
  const channels = 4 + numClasses;
  const n = boxes.length;
  const out = new Float32Array(channels * n);
  boxes.forEach((b, i) => {
    out[0 * n + i] = b.cx; out[1 * n + i] = b.cy; out[2 * n + i] = b.w; out[3 * n + i] = b.h;
    out[(4 + b.cls) * n + i] = b.score;
  });
  return { out, shape: [1, channels, n] };
}

test('keeps confident boxes and drops weak ones', () => {
  const { out, shape } = fakeOutput([
    { cx: 0.5, cy: 0.5, w: 0.6, h: 0.8, cls: 5, score: 0.9 },   // bus
    { cx: 0.1, cy: 0.5, w: 0.1, h: 0.3, cls: 0, score: 0.2 },   // weak person
  ]);
  const result = decodeYolo(out, { shape, inputSize: 320 });
  assert.deepEqual(result.map(d => d.label), ['bus']);
  const obj = toDetectedObject(result[0]);
  assert.equal(obj.position, 'center');
  assert.ok(Math.abs(obj.area - 0.48) < 1e-6);
});

test('removes overlapping boxes of the same class but keeps other classes', () => {
  const { out, shape } = fakeOutput([
    { cx: 0.2, cy: 0.5, w: 0.2, h: 0.4, cls: 0, score: 0.9 },
    { cx: 0.21, cy: 0.5, w: 0.2, h: 0.4, cls: 0, score: 0.8 },  // duplicate person
    { cx: 0.2, cy: 0.5, w: 0.2, h: 0.4, cls: 56, score: 0.7 },  // chair at same spot
    { cx: 0.8, cy: 0.5, w: 0.2, h: 0.4, cls: 0, score: 0.6 },   // second person, right
  ]);
  const result = decodeYolo(out, { shape, inputSize: 320 }).map(toDetectedObject);
  assert.deepEqual(result.map(o => `${o.label}/${o.position}`), ['person/left', 'chair/left', 'person/right']);
});

test('handles pixel coordinates and the transposed [1, N, channels] layout', () => {
  const channels = 84;
  const out = new Float32Array(channels);
  out.set([256, 160, 64, 64]); // pixels on a 320 input -> center x 0.8
  out[4 + 2] = 0.95;           // car
  const [obj] = decodeYolo(out, { shape: [1, 1, channels], inputSize: 320 }).map(toDetectedObject);
  assert.equal(obj.label, 'car');
  assert.equal(obj.position, 'right');
  assert.ok(Math.abs(obj.area - 0.04) < 1e-6);
});

test('reads the input layout of both PyTorch (LiteRT) and TensorFlow exports', () => {
  assert.deepEqual(inputLayoutOf([1, 3, 320, 320]), { layout: 'nchw', height: 320, width: 320 });
  assert.deepEqual(inputLayoutOf([1, 640, 480, 3]), { layout: 'nhwc', height: 640, width: 480 });
  assert.throws(() => inputLayoutOf([1, 320, 320]));
});

test('builds the input tensor in the model channel order', () => {
  // 2 pixels: (255, 0, 51) and (0, 255, 102)
  const rgb = new Uint8Array([255, 0, 51, 0, 255, 102]);
  const nchw = new Float32Array(toInputTensor(rgb, { layout: 'nchw', width: 2, height: 1 }, 'float32'));
  assert.deepEqual([...nchw].map(v => +v.toFixed(2)), [1, 0, 0, 1, 0.2, 0.4]);
  const nhwc = new Float32Array(toInputTensor(rgb, { layout: 'nhwc', width: 2, height: 1 }, 'float32'));
  assert.deepEqual([...nhwc].map(v => +v.toFixed(2)), [1, 0, 0.2, 0, 1, 0.4]);
  assert.throws(() => toInputTensor(rgb, { layout: 'nchw', width: 3, height: 1 }, 'float32'));
});
