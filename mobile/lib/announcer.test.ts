// Run with: npm test   (uses Node's built-in test runner, no extra packages)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnnouncer, type DetectedObject, type Position } from './announcer.ts';

const obj = (label: string, position: Position, area: number, confidence = 0.9): DetectedObject =>
  ({ label, position, area, confidence });

test('announces a new object once, then stays quiet', () => {
  const a = createAnnouncer();
  assert.equal(a.update([obj('chair', 'left', 0.05)], null, 0).speech, 'Chair on the left.');
  assert.equal(a.update([obj('chair', 'left', 0.05)], null, 1000).speech, null);
});

test('announces when an object gets closer, not when it only moves sideways', () => {
  const a = createAnnouncer();
  a.update([obj('chair', 'left', 0.05)], null, 0);
  assert.equal(a.update([obj('chair', 'center', 0.05)], null, 1000).speech, null);
  assert.equal(a.update([obj('chair', 'center', 0.12)], null, 2000).speech, 'Chair ahead, near.');
});

test('warns about very close objects first and repeats while they stay close', () => {
  const a = createAnnouncer();
  const first = a.update([obj('chair', 'left', 0.1), obj('car', 'center', 0.4)], null, 0);
  assert.equal(first.warning, true);
  assert.equal(first.speech, 'Careful! Car ahead, very close. Chair on the left, near.');
  assert.equal(a.update([obj('car', 'center', 0.4)], null, 1000).speech, null);
  assert.equal(a.update([obj('car', 'center', 0.4)], null, 4500).speech, 'Careful! Car ahead, very close.');
});

test('groups objects by label and says where the nearest one is', () => {
  const a = createAnnouncer();
  const r = a.update([obj('person', 'left', 0.11), obj('person', 'right', 0.03), obj('person', 'left', 0.06)], null, 0);
  assert.equal(r.speech, '3 people, nearest on the left, near.');
  const b = createAnnouncer();
  assert.equal(b.update([obj('person', 'right', 0.03), obj('person', 'right', 0.02)], null, 0).speech,
    '2 people on the right.');
});

test('reads new text once, ignoring case and spacing changes', () => {
  const a = createAnnouncer();
  a.update([], null, 0);
  assert.equal(a.update([], 'EXIT', 1000).speech, 'Text: EXIT.');
  assert.equal(a.update([], ' exit ', 2000).speech, null);
});

test('ignores low-confidence detections', () => {
  const a = createAnnouncer();
  a.update([], null, 0);
  assert.equal(a.update([obj('dog', 'left', 0.1, 0.2)], null, 1000).speech, null);
});

test('gives a heartbeat after long silence and re-announces forgotten objects', () => {
  const a = createAnnouncer();
  assert.equal(a.update([], null, 0).speech, 'Path clear.');
  a.update([obj('chair', 'left', 0.05)], null, 1000);
  assert.equal(a.update([], null, 5000).speech, null);
  assert.equal(a.update([], null, 20000).speech, 'Path clear.');
  assert.equal(a.update([obj('chair', 'left', 0.05)], null, 21000).speech, 'Chair on the left.');
});

test('heartbeat mentions objects that are still around', () => {
  const a = createAnnouncer();
  a.update([obj('chair', 'left', 0.05)], null, 0);
  // One frame per second, like the app: quiet until the 15 s heartbeat.
  for (let t = 1000; t < 15000; t += 1000) {
    assert.equal(a.update([obj('chair', 'left', 0.05)], null, t).speech, null);
  }
  assert.equal(a.update([obj('chair', 'left', 0.05)], null, 15000).speech,
    'Still around you: chair on the left.');
});
