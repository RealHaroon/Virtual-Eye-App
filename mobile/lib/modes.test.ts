import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dominantColours, meanLuminance, nameColour } from './colour.ts';
import { classifyTouch, cycle } from './gestures.ts';
import { colourWords } from './i18n.ts';
import { lightLevel } from './light.ts';
import { createFaceDownTracker, faceDownState } from './battery.ts';

const name = (r: number, g: number, b: number) => colourWords(nameColour(r, g, b), 'en');

test('names common colours', () => {
  const cases: [number, number, number, string][] = [
    [220, 30, 30, 'red'], [255, 140, 0, 'orange'], [250, 220, 40, 'yellow'],
    [40, 160, 60, 'green'], [0, 170, 170, 'teal'], [0, 128, 128, 'dark teal'], [30, 80, 200, 'blue'], [10, 20, 90, 'dark blue'],
    [130, 50, 180, 'purple'], [255, 105, 180, 'pink'], [120, 72, 30, 'brown'],
    [10, 10, 10, 'black'], [250, 250, 250, 'white'], [128, 128, 128, 'grey'], [60, 60, 60, 'dark grey'],
    [173, 216, 230, 'light blue'],
  ];
  for (const [r, g, b, expected] of cases) assert.equal(name(r, g, b), expected, `rgb(${r},${g},${b})`);
});

const fill = (pixels: [number, number, number, number][]) =>
  new Uint8Array(pixels.flatMap(([r, g, b, n]) => Array.from({ length: n }, () => [r, g, b]).flat()));

test('finds the main colour and mentions a big second one', () => {
  const shirt = fill([[10, 20, 90, 70], [250, 250, 250, 30]]);
  const { main, second } = dominantColours(shirt);
  assert.equal(colourWords(main, 'en'), 'dark blue');
  assert.equal(second && colourWords(second, 'en'), 'white');
});

test('ignores small specks and shades of the same colour', () => {
  const { second } = dominantColours(fill([[220, 30, 30, 80], [120, 10, 10, 15], [0, 0, 255, 5]]));
  assert.equal(second, null);
});

test('measures brightness from the light sensor or the image', () => {
  assert.equal(lightLevel(2, null), 'veryDark');
  assert.equal(lightLevel(300, 10), 'indoor'); // sensor wins over the image
  assert.equal(lightLevel(null, meanLuminance(fill([[20, 20, 20, 10]]))), 'veryDark');
  assert.equal(lightLevel(null, meanLuminance(fill([[200, 200, 200, 10]]))), 'bright');
});

test('tells taps, swipes and other movements apart', () => {
  assert.equal(classifyTouch(3, -4), 'tap');
  assert.equal(classifyTouch(-120, 10), 'swipeLeft');
  assert.equal(classifyTouch(90, -20), 'swipeRight');
  assert.equal(classifyTouch(20, 150), 'none'); // vertical
  assert.equal(classifyTouch(30, 5), 'none');   // too short for a swipe, too long for a tap
});

test('swiping cycles through modes and wraps around', () => {
  const modes = ['scan', 'read', 'colour', 'light'] as const;
  assert.equal(cycle(modes, 'scan', 'swipeLeft'), 'read');
  assert.equal(cycle(modes, 'light', 'swipeLeft'), 'scan');
  assert.equal(cycle(modes, 'scan', 'swipeRight'), 'light');
});

test('pauses after 2 s face down and resumes when picked up', () => {
  const t = createFaceDownTracker('android');
  assert.equal(t.update(1.0, 0), null);       // face up on Android
  assert.equal(t.update(-0.98, 100), null);   // turned over
  assert.equal(t.update(-0.97, 1500), null);  // not long enough yet
  assert.equal(t.update(-0.99, 2200), 'pause');
  assert.equal(t.update(-0.7, 2500), null);   // still mostly down (hysteresis)
  assert.equal(t.update(0.2, 3000), 'resume');
});

test('a quick flip does not pause, and iOS axis is reversed', () => {
  const t = createFaceDownTracker('android');
  t.update(-0.95, 0);
  assert.equal(t.update(0.9, 800), null);
  assert.equal(faceDownState(0.95, 'ios', false), true);
  assert.equal(faceDownState(-0.95, 'ios', false), false);
});
