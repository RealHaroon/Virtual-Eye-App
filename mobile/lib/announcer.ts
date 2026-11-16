// Decides what Virtual Eye should say for each camera frame.
//
// Instead of describing everything every frame, it remembers what was already
// announced and only speaks when something matters:
//   - a new object appears,
//   - an object gets closer,
//   - something is very close (repeated every few seconds while it stays close),
//   - new text appears.
// If nothing has been said for a while, it gives a short "still here" summary
// so the user knows the app is working.
//
// Pure logic with no React Native imports, so it works the same whether
// detection runs on the server or on the phone.

import { objectPhrase, SCENE, type Language } from './i18n.ts';

export type Position = 'left' | 'center' | 'right';
export type Proximity = 'far' | 'near' | 'close';

export type DetectedObject = {
  label: string;
  position: Position;
  /** Share of the frame covered by the bounding box, 0..1. */
  area: number;
  confidence: number;
};

export type Announcement = {
  /** What to say out loud, or null to stay quiet this frame. */
  speech: string | null;
  /** True when something is very close: vibrate and use the urgent voice. */
  warning: boolean;
  /** Full description of the current frame, for the on-screen status. */
  summary: string;
};

export type AnnouncerOptions = {
  /** Forget an object not seen for this long; it is announced again if it returns. */
  forgetAfterMs: number;
  /** Repeat a "very close" warning this often while the object stays close. */
  warningRepeatMs: number;
  /** Give a short summary after this much silence. */
  heartbeatMs: number;
  /** Most objects mentioned in one announcement. */
  maxItems: number;
  /** Ignore detections below this confidence. */
  minConfidence: number;
  /** Don't announce objects farther than this ('near' = only near or very close). */
  minProximity: Proximity;
  language: Language;
};

export const DEFAULT_OPTIONS: AnnouncerOptions = {
  forgetAfterMs: 6000,
  warningRepeatMs: 4000,
  heartbeatMs: 15000,
  maxItems: 3,
  minConfidence: 0.35,
  minProximity: 'far',
  language: 'en',
};

/** How much the app talks. Chosen in Settings. */
export type Verbosity = 'quiet' | 'normal' | 'detailed';

export const VERBOSITY_OPTIONS: Record<Verbosity, Partial<AnnouncerOptions>> = {
  // Only things that are near or very close, plus text; rare "still here" updates.
  quiet: { minProximity: 'near', maxItems: 2, heartbeatMs: 30000 },
  normal: {},
  // More objects, more often, including less certain ones.
  detailed: { maxItems: 4, heartbeatMs: 8000, minConfidence: 0.3 },
};

/** Bounding box share of the frame at which an object counts as close / near. */
export const CLOSE_AREA = 0.25;
export const NEAR_AREA = 0.08;

const VEHICLES = new Set(['car', 'motorcycle', 'bus', 'truck', 'bicycle', 'train']);
const MOVING = new Set(['person', 'dog', 'cat', 'horse', 'cow', 'sheep']);
const OBSTACLES = new Set([
  'chair', 'bench', 'couch', 'bed', 'dining table', 'potted plant', 'fire hydrant',
  'stop sign', 'traffic light', 'parking meter', 'suitcase', 'toilet', 'refrigerator',
]);

const PROXIMITY_RANK: Record<Proximity, number> = { far: 0, near: 1, close: 2 };

export function proximityOf(area: number): Proximity {
  if (area >= CLOSE_AREA) return 'close';
  if (area >= NEAR_AREA) return 'near';
  return 'far';
}

/** Higher = more important. Anything very close outranks everything else. */
export function priorityOf(obj: DetectedObject): number {
  let base = 0;
  if (VEHICLES.has(obj.label)) base = 30;
  else if (MOVING.has(obj.label)) base = 20;
  else if (OBSTACLES.has(obj.label)) base = 10;
  const closeBonus = proximityOf(obj.area) === 'close' ? 100 : 0;
  return closeBonus + base + obj.area; // area breaks ties: bigger = closer
}

/** The closest instance of a label, plus how many there are and where. */
type SceneItem = DetectedObject & { count: number; positions: Set<Position> };

/** One entry per label: the largest box (closest instance) plus how many there are. */
function groupByLabel(objects: DetectedObject[], minConfidence: number): SceneItem[] {
  const byLabel = new Map<string, SceneItem>();
  for (const obj of objects) {
    if (obj.confidence < minConfidence) continue;
    const existing = byLabel.get(obj.label);
    if (!existing) {
      byLabel.set(obj.label, { ...obj, count: 1, positions: new Set([obj.position]) });
    } else {
      const count = existing.count + 1;
      const positions = new Set(existing.positions).add(obj.position);
      const closest = obj.area > existing.area ? obj : existing;
      byLabel.set(obj.label, { ...closest, count, positions });
    }
  }
  return [...byLabel.values()].sort((a, b) => priorityOf(b) - priorityOf(a));
}

/** Short phrase for one kind of object, e.g. "Car ahead, very close" (see i18n.ts). */
export function phrase(item: SceneItem, language: Language = 'en'): string {
  return objectPhrase({
    label: item.label,
    count: item.count,
    spread: item.positions.size > 1,
    position: item.position,
    proximity: proximityOf(item.area),
  }, language);
}

/**
 * Full description of everything in view, for "describe now" (double-tap),
 * regardless of what was already announced.
 */
export function describeScene(
  objects: DetectedObject[],
  ocrText: string | null,
  { maxItems = 5, minConfidence = DEFAULT_OPTIONS.minConfidence, language = 'en' as Language } = {},
): string {
  const words = SCENE[language];
  const parts = groupByLabel(objects, minConfidence).slice(0, maxItems).map(item => phrase(item, language));
  const ocr = ocrText?.trim();
  if (ocr) parts.push(words.text(ocr));
  if (parts.length === 0) return words.nothingDetected;
  return words.sentences(parts);
}

const normalizeText = (text: string) => text.toLowerCase().replace(/\s+/g, ' ').trim();

type Memory = {
  proximity: Proximity;
  position: Position;
  lastSeen: number;
  lastSpoken: number;
};

export function createAnnouncer(overrides: Partial<AnnouncerOptions> = {}) {
  const opts: AnnouncerOptions = { ...DEFAULT_OPTIONS, ...overrides };
  const words = SCENE[opts.language];
  const say = (item: SceneItem) => phrase(item, opts.language);
  const memory = new Map<string, Memory>();
  let lastOcr: string | null = null;
  let lastSpokenAt = -Infinity;

  function reset() {
    memory.clear();
    lastOcr = null;
    lastSpokenAt = -Infinity;
  }

  function update(objects: DetectedObject[], ocrText: string | null, now = Date.now()): Announcement {
    for (const [label, mem] of memory) {
      if (now - mem.lastSeen > opts.forgetAfterMs) memory.delete(label);
    }

    const scene = groupByLabel(objects, opts.minConfidence);

    const news: SceneItem[] = [];
    for (const item of scene) {
      const proximity = proximityOf(item.area);
      const prev = memory.get(item.label);
      const isClose = proximity === 'close';

      const isNews =
        !prev ||
        PROXIMITY_RANK[proximity] > PROXIMITY_RANK[prev.proximity] ||
        (isClose && prev.position !== item.position) ||
        (isClose && now - prev.lastSpoken >= opts.warningRepeatMs);

      const farEnough = PROXIMITY_RANK[proximity] >= PROXIMITY_RANK[opts.minProximity];
      if (isNews && farEnough) news.push(item);
      memory.set(item.label, {
        proximity,
        position: item.position,
        lastSeen: now,
        lastSpoken: prev?.lastSpoken ?? -Infinity,
      });
    }

    const toSay = news.slice(0, opts.maxItems);
    const warning = toSay.some(item => proximityOf(item.area) === 'close');
    const parts = toSay.map(say);

    const ocr = ocrText?.trim() || null;
    if (ocr && normalizeText(ocr) !== lastOcr) {
      parts.push(words.text(ocr));
      lastOcr = normalizeText(ocr);
    }

    // Heartbeat: after a long silence, briefly say what's still around.
    if (parts.length === 0 && now - lastSpokenAt >= opts.heartbeatMs) {
      parts.push(scene.length === 0
        ? words.pathClear
        : words.stillAround(scene.slice(0, 2).map(say)));
    }

    let speech: string | null = null;
    if (parts.length > 0) {
      speech = (warning ? words.careful : '') + words.sentences(parts);
      lastSpokenAt = now;
      for (const item of toSay) {
        const mem = memory.get(item.label);
        if (mem) mem.lastSpoken = now;
      }
    }

    const summaryParts = scene.slice(0, opts.maxItems).map(say);
    if (ocr) summaryParts.push(words.text(ocr));
    const summary = summaryParts.length > 0 ? summaryParts.join('\n') : words.pathClear;

    return { speech, warning, summary };
  }

  return { update, reset };
}

export type Announcer = ReturnType<typeof createAnnouncer>;
