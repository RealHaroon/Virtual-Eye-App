// Everything Virtual Eye says, in English and Urdu.
// Pure logic with no React Native imports, so it can be unit tested with Node.
//
// To add a language: add it to `Language`, `SPEECH_LANGUAGE_CODES`, and give
// every table below an entry for it. TypeScript will point at anything missing.

export type Language = 'en' | 'ur';

/** Language code for the phone's text-to-speech engine. */
export const SPEECH_LANGUAGE_CODES: Record<Language, string> = { en: 'en-US', ur: 'ur-PK' };

type Position = 'left' | 'center' | 'right';
type Proximity = 'far' | 'near' | 'close';

// ---------------------------------------------------------------------------
// Object names (the 80 COCO classes the YOLO model detects)
// ---------------------------------------------------------------------------

const LABELS_UR: Record<string, string> = {
  'person': 'شخص', 'bicycle': 'سائیکل', 'car': 'کار', 'motorcycle': 'موٹر سائیکل',
  'airplane': 'ہوائی جہاز', 'bus': 'بس', 'train': 'ٹرین', 'truck': 'ٹرک', 'boat': 'کشتی',
  'traffic light': 'ٹریفک لائٹ', 'fire hydrant': 'فائر ہائیڈرنٹ', 'stop sign': 'رکنے کا نشان',
  'parking meter': 'پارکنگ میٹر', 'bench': 'بینچ', 'bird': 'پرندہ', 'cat': 'بلی', 'dog': 'کتا',
  'horse': 'گھوڑا', 'sheep': 'بھیڑ', 'cow': 'گائے', 'elephant': 'ہاتھی', 'bear': 'ریچھ',
  'zebra': 'زیبرا', 'giraffe': 'زرافہ', 'backpack': 'بستہ', 'umbrella': 'چھتری',
  'handbag': 'ہینڈ بیگ', 'tie': 'ٹائی', 'suitcase': 'سوٹ کیس', 'frisbee': 'فریسبی',
  'skis': 'اسکیز', 'snowboard': 'اسنو بورڈ', 'sports ball': 'گیند', 'kite': 'پتنگ',
  'baseball bat': 'بیس بال بیٹ', 'baseball glove': 'بیس بال دستانہ', 'skateboard': 'اسکیٹ بورڈ',
  'surfboard': 'سرف بورڈ', 'tennis racket': 'ٹینس ریکٹ', 'bottle': 'بوتل', 'wine glass': 'گلاس',
  'cup': 'کپ', 'fork': 'کانٹا', 'knife': 'چھری', 'spoon': 'چمچ', 'bowl': 'پیالہ', 'banana': 'کیلا',
  'apple': 'سیب', 'sandwich': 'سینڈوچ', 'orange': 'مالٹا', 'broccoli': 'بروکلی', 'carrot': 'گاجر',
  'hot dog': 'ہاٹ ڈاگ', 'pizza': 'پیزا', 'donut': 'ڈونٹ', 'cake': 'کیک', 'chair': 'کرسی',
  'couch': 'صوفہ', 'potted plant': 'گملے کا پودا', 'bed': 'بستر', 'dining table': 'میز',
  'toilet': 'ٹوائلٹ', 'tv': 'ٹی وی', 'laptop': 'لیپ ٹاپ', 'mouse': 'ماؤس', 'remote': 'ریموٹ',
  'keyboard': 'کی بورڈ', 'cell phone': 'موبائل فون', 'microwave': 'مائیکروویو', 'oven': 'اوون',
  'toaster': 'ٹوسٹر', 'sink': 'سنک', 'refrigerator': 'فریج', 'book': 'کتاب', 'clock': 'گھڑی',
  'vase': 'گلدان', 'scissors': 'قینچی', 'teddy bear': 'ٹیڈی بیئر', 'hair drier': 'ہیئر ڈرائر',
  'toothbrush': 'ٹوتھ برش',
};

function pluralEn(label: string): string {
  if (label === 'person') return 'people';
  if (/(s|sh|ch|x)$/.test(label)) return `${label}es`;
  return `${label}s`;
}

const POSITIONS: Record<Language, Record<Position, string>> = {
  en: { left: 'on the left', center: 'ahead', right: 'on the right' },
  ur: { left: 'بائیں طرف', center: 'سامنے', right: 'دائیں طرف' },
};

const DISTANCES: Record<Language, Record<Proximity, string>> = {
  en: { far: '', near: ', near', close: ', very close' },
  ur: { far: '', near: '، قریب', close: '، بہت قریب' },
};

export type PhraseInput = {
  label: string;
  count: number;
  /** True when several of this object are spread over different positions. */
  spread: boolean;
  position: Position;
  proximity: Proximity;
};

/**
 * Short phrase for one kind of object, e.g. "Car ahead, very close",
 * "2 people on the left", "3 people, nearest on the right, near".
 */
export function objectPhrase(item: PhraseInput, lang: Language): string {
  const where = POSITIONS[lang][item.position];
  const distance = DISTANCES[lang][item.proximity];
  if (lang === 'ur') {
    const name = LABELS_UR[item.label] ?? item.label;
    const many = item.label === 'person' ? 'لوگ' : name;
    if (item.count === 1) return `${name} ${where}${distance}`;
    if (!item.spread) return `${item.count} ${many} ${where}${distance}`;
    return `${item.count} ${many}، سب سے قریب ${where}${distance}`;
  }
  let text: string;
  if (item.count === 1) text = `${item.label} ${where}`;
  else if (!item.spread) text = `${item.count} ${pluralEn(item.label)} ${where}`;
  else text = `${item.count} ${pluralEn(item.label)}, nearest ${where}`;
  text += distance;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// ---------------------------------------------------------------------------
// Scene sentences used by the announcer
// ---------------------------------------------------------------------------

type SceneWords = {
  careful: string;
  text: (text: string) => string;
  pathClear: string;
  stillAround: (list: string[]) => string;
  nothingDetected: string;
  /** Joins sentences and ends with a full stop. */
  sentences: (parts: string[]) => string;
};

export const SCENE: Record<Language, SceneWords> = {
  en: {
    careful: 'Careful! ',
    text: text => `Text: ${text}`,
    pathClear: 'Path clear',
    stillAround: list => `Still around you: ${list.join(', ').toLowerCase()}`,
    nothingDetected: 'Nothing detected. The path looks clear.',
    sentences: parts => parts.join('. ') + '.',
  },
  ur: {
    careful: 'خبردار! ',
    text: text => `تحریر: ${text}`,
    pathClear: 'راستہ صاف ہے',
    stillAround: list => `آس پاس اب بھی: ${list.join('، ')}`,
    nothingDetected: 'کچھ نظر نہیں آیا۔ راستہ صاف لگتا ہے۔',
    sentences: parts => parts.join('۔ ') + '۔',
  },
};

// ---------------------------------------------------------------------------
// App messages
// ---------------------------------------------------------------------------

export type Mode = 'scan' | 'read' | 'colour' | 'light';
export const MODES: Mode[] = ['scan', 'read', 'colour', 'light'];

const MESSAGES = {
  en: {
    welcome: 'Welcome to Virtual Eye. Tap anywhere to start. Swipe left or right to change mode.',
    detectionStarted: 'Detection started.',
    readingStarted: 'Reading started. Point the camera at text.',
    stopped: 'Stopped. Tap anywhere to start again.',
    detectionError: 'Detection is not working right now. Trying again.',
    serverDown: 'Server not reachable. Using on-device detection.',
    serverBack: 'Connected to server.',
    flashlightOn: 'Flashlight on.',
    flashlightOff: 'Flashlight off.',
    nothingToRepeat: 'Nothing to repeat yet.',
    couldNotLook: 'I could not look right now. Please try again.',
    noTextFound: 'No text found. Hold the camera steady, about a hand’s length from the text.',
    speechSpeed: (speed: string) => `Speech speed ${speed}.`,
    verbosity: (level: string) => `${level} mode.`,
    languageChanged: 'Language: English.',
    pausedFaceDown: 'Paused. The phone is face down. Pick it up to continue.',
    resumed: 'Resumed.',
  },
  ur: {
    welcome: 'ورچوئل آئی میں خوش آمدید۔ شروع کرنے کے لیے کہیں بھی ٹیپ کریں۔ موڈ بدلنے کے لیے دائیں یا بائیں سوائپ کریں۔',
    detectionStarted: 'پہچان شروع ہو گئی۔',
    readingStarted: 'پڑھنا شروع۔ کیمرہ تحریر کی طرف کریں۔',
    stopped: 'رک گیا۔ دوبارہ شروع کرنے کے لیے کہیں بھی ٹیپ کریں۔',
    detectionError: 'پہچان ابھی کام نہیں کر رہی۔ دوبارہ کوشش ہو رہی ہے۔',
    serverDown: 'سرور سے رابطہ نہیں ہو سکا۔ فون پر ہی پہچان جاری ہے۔',
    serverBack: 'سرور سے رابطہ ہو گیا۔',
    flashlightOn: 'ٹارچ آن۔',
    flashlightOff: 'ٹارچ آف۔',
    nothingToRepeat: 'دہرانے کے لیے ابھی کچھ نہیں۔',
    couldNotLook: 'ابھی دیکھ نہیں سکا۔ براہ کرم دوبارہ کوشش کریں۔',
    noTextFound: 'کوئی تحریر نہیں ملی۔ کیمرہ تحریر سے ایک ہاتھ کے فاصلے پر سیدھا رکھیں۔',
    speechSpeed: (speed: string) => `بولنے کی رفتار: ${({ slow: 'آہستہ', normal: 'عام', fast: 'تیز' } as Record<string, string>)[speed] ?? speed}۔`,
    verbosity: (level: string) => `${({ quiet: 'خاموش', normal: 'عام', detailed: 'تفصیلی' } as Record<string, string>)[level] ?? level} موڈ۔`,
    languageChanged: 'زبان: اردو۔',
    pausedFaceDown: 'رک گیا۔ فون الٹا رکھا ہے۔ جاری رکھنے کے لیے اٹھائیں۔',
    resumed: 'دوبارہ شروع۔',
  },
} satisfies Record<Language, Record<string, string | ((arg: string) => string)>>;

export type MessageKey = keyof typeof MESSAGES.en;
type StaticKey = { [K in MessageKey]: typeof MESSAGES.en[K] extends string ? K : never }[MessageKey];

/** A fixed app message in the given language. */
export function msg(key: StaticKey, lang: Language): string {
  return MESSAGES[lang][key];
}

/** Messages that take a value, e.g. msgWith('speechSpeed', 'fast', 'en'). */
export function msgWith(key: 'speechSpeed' | 'verbosity', value: string, lang: Language): string {
  return MESSAGES[lang][key](value);
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

const MODE_TEXT: Record<Language, Record<Mode, { name: string; intro: string }>> = {
  en: {
    scan: { name: 'Scan', intro: 'Scan mode. Tap to start describing your surroundings.' },
    read: { name: 'Read text', intro: 'Read text mode. Tap to start reading text out loud.' },
    colour: { name: 'Colour', intro: 'Colour mode. Point at something and tap to hear its colour.' },
    light: { name: 'Light', intro: 'Light mode. Tap to hear how bright it is.' },
  },
  ur: {
    scan: { name: 'اسکین', intro: 'اسکین موڈ۔ ارد گرد کی معلومات کے لیے ٹیپ کریں۔' },
    read: { name: 'تحریر', intro: 'تحریر موڈ۔ تحریر پڑھوانے کے لیے ٹیپ کریں۔' },
    colour: { name: 'رنگ', intro: 'رنگ موڈ۔ کسی چیز کی طرف کریں اور اس کا رنگ سننے کے لیے ٹیپ کریں۔' },
    light: { name: 'روشنی', intro: 'روشنی موڈ۔ روشنی جاننے کے لیے ٹیپ کریں۔' },
  },
};

export const modeName = (mode: Mode, lang: Language) => MODE_TEXT[lang][mode].name;
export const modeIntro = (mode: Mode, lang: Language) => MODE_TEXT[lang][mode].intro;

// ---------------------------------------------------------------------------
// Colours and light
// ---------------------------------------------------------------------------

export type ColourBase =
  | 'red' | 'orange' | 'yellow' | 'green' | 'teal' | 'blue' | 'purple' | 'pink'
  | 'brown' | 'black' | 'white' | 'grey';
export type Shade = 'dark' | 'light' | null;
export type ColourName = { base: ColourBase; shade: Shade };

const COLOURS_UR: Record<ColourBase, string> = {
  red: 'سرخ', orange: 'نارنجی', yellow: 'پیلا', green: 'سبز', teal: 'فیروزی', blue: 'نیلا',
  purple: 'جامنی', pink: 'گلابی', brown: 'بھورا', black: 'کالا', white: 'سفید', grey: 'سرمئی',
};

export function colourWords(c: ColourName, lang: Language): string {
  if (lang === 'ur') {
    const shade = c.shade === 'dark' ? 'گہرا ' : c.shade === 'light' ? 'ہلکا ' : '';
    return shade + COLOURS_UR[c.base];
  }
  return (c.shade ? `${c.shade} ` : '') + c.base;
}

/** "Dark blue." or "Mostly dark blue, with some white." */
export function colourSentence(main: ColourName, second: ColourName | null, lang: Language): string {
  const a = colourWords(main, lang);
  if (lang === 'ur') {
    return second ? `زیادہ تر ${a}، کچھ ${colourWords(second, lang)}۔` : `${a}۔`;
  }
  const sentence = second ? `Mostly ${a}, with some ${colourWords(second, lang)}.` : `${a}.`;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export type LightLevel = 'veryDark' | 'dim' | 'indoor' | 'bright' | 'veryBright';

const LIGHT_TEXT: Record<Language, Record<LightLevel, string>> = {
  en: {
    veryDark: 'Very dark. The lights are probably off.',
    dim: 'Dim light.',
    indoor: 'Normal indoor light. The lights are on.',
    bright: 'Bright light.',
    veryBright: 'Very bright, like daylight or a strong lamp.',
  },
  ur: {
    veryDark: 'بہت اندھیرا ہے۔ شاید بتیاں بند ہیں۔',
    dim: 'روشنی کم ہے۔',
    indoor: 'کمرے کی عام روشنی۔ بتیاں جل رہی ہیں۔',
    bright: 'روشنی تیز ہے۔',
    veryBright: 'بہت تیز روشنی، جیسے دن کی روشنی یا تیز بلب۔',
  },
};

export const lightSentence = (level: LightLevel, lang: Language) => LIGHT_TEXT[lang][level];

// ---------------------------------------------------------------------------
// Tutorial (spoken on first launch; can be replayed from Settings)
// ---------------------------------------------------------------------------

export const TUTORIAL: Record<Language, string> = {
  en:
    'Welcome to Virtual Eye. Here is how to use it. ' +
    'Hold the phone in front of you, with the back camera facing forward. ' +
    'Tap anywhere on the screen to start or stop. ' +
    'Double-tap to hear everything in view. ' +
    'Touch and hold to repeat the last message. ' +
    'Swipe left or right to change mode. There are four modes: ' +
    'Scan describes objects around you and warns when something is very close. ' +
    'Read text reads signs, labels and documents. ' +
    'Colour tells you the colour of what the camera is pointing at. ' +
    'Light tells you how bright it is. ' +
    'Settings are in the top right corner. You can replay this tutorial there. ' +
    'Tap anywhere to begin.',
  ur:
    'ورچوئل آئی میں خوش آمدید۔ استعمال کا طریقہ یہ ہے۔ ' +
    'فون اپنے سامنے رکھیں، پچھلا کیمرہ آگے کی طرف ہو۔ ' +
    'شروع یا بند کرنے کے لیے اسکرین پر کہیں بھی ٹیپ کریں۔ ' +
    'سامنے کی ہر چیز سننے کے لیے دو بار ٹیپ کریں۔ ' +
    'آخری پیغام دہرانے کے لیے انگلی دبا کر رکھیں۔ ' +
    'موڈ بدلنے کے لیے دائیں یا بائیں سوائپ کریں۔ چار موڈ ہیں: ' +
    'اسکین ارد گرد کی چیزیں بتاتا ہے اور بہت قریب چیز پر خبردار کرتا ہے۔ ' +
    'تحریر نشان، لیبل اور کاغذات پڑھتا ہے۔ ' +
    'رنگ بتاتا ہے کہ کیمرے کے سامنے چیز کا رنگ کیا ہے۔ ' +
    'روشنی بتاتا ہے کہ روشنی کتنی ہے۔ ' +
    'سیٹنگز اوپر دائیں کونے میں ہیں، وہاں سے یہ رہنمائی دوبارہ سن سکتے ہیں۔ ' +
    'شروع کرنے کے لیے کہیں بھی ٹیپ کریں۔',
};
