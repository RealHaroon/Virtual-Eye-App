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
};

export const DEFAULT_OPTIONS: AnnouncerOptions = {
  forgetAfterMs: 6000,
  warningRepeatMs: 4000,
  heartbeatMs: 15000,
  maxItems: 3,
  minConfidence: 0.35,
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

function plural(label: string): string {
  if (label === 'person') return 'people';
  if (/(s|sh|ch|x)$/.test(label)) return `${label}es`;
  return `${label}s`;
}

const POSITION_WORDS: Record<Position, string> = {
  left: 'on the left',
  center: 'ahead',
  right: 'on the right',
};

/**
 * Short phrase, e.g. "Car ahead, very close", "2 people on the left", or,
 * when a group is spread out, "3 people, nearest on the right, near".
 * Distance always describes the nearest one.
 */
export function phrase(item: SceneItem): string {
  const proximity = proximityOf(item.area);
  const distance = proximity === 'close' ? ', very close' : proximity === 'near' ? ', near' : '';
  const where = POSITION_WORDS[item.position];
  let text: string;
  if (item.count === 1) text = `${item.label} ${where}`;
  else if (item.positions.size === 1) text = `${item.count} ${plural(item.label)} ${where}`;
  else text = `${item.count} ${plural(item.label)}, nearest ${where}`;
  text += distance;
  return text.charAt(0).toUpperCase() + text.slice(1);
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

      if (isNews) news.push(item);
      memory.set(item.label, {
        proximity,
        position: item.position,
        lastSeen: now,
        lastSpoken: prev?.lastSpoken ?? -Infinity,
      });
    }

    const toSay = news.slice(0, opts.maxItems);
    const warning = toSay.some(item => proximityOf(item.area) === 'close');
    const parts = toSay.map(phrase);

    const ocr = ocrText?.trim() || null;
    if (ocr && normalizeText(ocr) !== lastOcr) {
      parts.push(`Text: ${ocr}`);
      lastOcr = normalizeText(ocr);
    }

    // Heartbeat: after a long silence, briefly say what's still around.
    if (parts.length === 0 && now - lastSpokenAt >= opts.heartbeatMs) {
      parts.push(scene.length === 0
        ? 'Path clear'
        : `Still around you: ${scene.slice(0, 2).map(phrase).join(', ').toLowerCase()}`);
    }

    let speech: string | null = null;
    if (parts.length > 0) {
      speech = (warning ? 'Careful! ' : '') + parts.join('. ') + '.';
      lastSpokenAt = now;
      for (const item of toSay) {
        const mem = memory.get(item.label);
        if (mem) mem.lastSpoken = now;
      }
    }

    const summaryParts = scene.slice(0, opts.maxItems).map(phrase);
    if (ocr) summaryParts.push(`Text: ${ocr}`);
    const summary = summaryParts.length > 0 ? summaryParts.join('\n') : 'Path clear';

    return { speech, warning, summary };
  }

  return { update, reset };
}

export type Announcer = ReturnType<typeof createAnnouncer>;
