import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAnnouncer, describeScene, type DetectedObject, type Position } from './announcer.ts';
import { colourSentence, lightSentence, modeIntro, msg, msgWith, objectPhrase } from './i18n.ts';
import { COCO_LABELS } from './yolo.ts';

const obj = (label: string, position: Position, area: number): DetectedObject =>
  ({ label, position, area, confidence: 0.9 });

test('every object the model can detect has an Urdu name', () => {
  const untranslated = COCO_LABELS.filter(label =>
    /[a-z]/i.test(objectPhrase({ label, count: 1, spread: false, position: 'left', proximity: 'far' }, 'ur')));
  assert.deepEqual(untranslated, []);
});

test('announcer speaks Urdu', () => {
  const a = createAnnouncer({ language: 'ur' });
  assert.equal(
    a.update([obj('car', 'center', 0.4), obj('chair', 'left', 0.1)], null, 0).speech,
    'خبردار! کار سامنے، بہت قریب۔ کرسی بائیں طرف، قریب۔',
  );
  assert.equal(a.update([], 'EXIT', 1000).speech, 'تحریر: EXIT۔');
});

test('Urdu groups people and says where the nearest one is', () => {
  assert.equal(
    describeScene([obj('person', 'left', 0.1), obj('person', 'right', 0.03)], null, { language: 'ur' }),
    '2 لوگ، سب سے قریب بائیں طرف، قریب۔',
  );
  assert.equal(describeScene([], null, { language: 'ur' }), 'کچھ نظر نہیں آیا۔ راستہ صاف لگتا ہے۔');
});

test('app messages, colours and light exist in both languages', () => {
  assert.equal(msg('flashlightOn', 'ur'), 'ٹارچ آن۔');
  assert.equal(msgWith('speechSpeed', 'fast', 'ur'), 'بولنے کی رفتار: تیز۔');
  assert.equal(msgWith('speechSpeed', 'fast', 'en'), 'Speech speed fast.');
  assert.equal(colourSentence({ base: 'blue', shade: 'dark' }, { base: 'white', shade: null }, 'en'),
    'Mostly dark blue, with some white.');
  assert.equal(colourSentence({ base: 'blue', shade: 'dark' }, null, 'ur'), 'گہرا نیلا۔');
  assert.equal(lightSentence('dim', 'en'), 'Dim light.');
  assert.ok(modeIntro('colour', 'ur').startsWith('رنگ موڈ'));
});
