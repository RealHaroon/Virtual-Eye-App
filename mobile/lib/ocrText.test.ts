import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanOcrLines } from './ocrText.ts';

test('keeps real text and drops noise', () => {
  assert.equal(cleanOcrLines(['EXIT', '|||', '.:', '  Platform   2 ']), 'EXIT, Platform 2');
});

test('splits multi-line blocks, removes duplicates and limits to 4 lines', () => {
  assert.equal(
    cleanOcrLines(['Paracetamol\n500 mg', 'PARACETAMOL', 'Tablets', 'Take two daily', 'Keep dry']),
    'Paracetamol, 500 mg, Tablets, Take two daily',
  );
});

test('returns null when nothing is readable', () => {
  assert.equal(cleanOcrLines([]), null);
  assert.equal(cleanOcrLines(['--', '| |', 'ab']), null);
});

test('cuts very long text at a word boundary', () => {
  const long = cleanOcrLines(['word '.repeat(60)]);
  assert.ok(long !== null && long.length <= 150 && !long.endsWith(' '));
});

test('reads Urdu text too', () => {
  assert.equal(cleanOcrLines(['باہر نکلیں']), 'باہر نکلیں');
});
