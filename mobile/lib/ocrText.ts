// Cleans raw OCR lines into something worth reading aloud.
// Pure logic, unit tested with Node.

const MAX_LINES = 4;
const MAX_CHARS = 150;

/** True when a line looks like real text rather than noise such as "|||" or ".:". */
function isMeaningful(line: string): boolean {
  const alnum = line.match(/[\p{L}\p{N}]/gu)?.length ?? 0;
  return alnum >= 3 && alnum / line.replace(/\s/g, '').length >= 0.5;
}

/** Joins the first few meaningful lines, or returns null when nothing is worth reading. */
export function cleanOcrLines(lines: string[]): string | null {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of lines) {
    for (const part of raw.split('\n')) {
      const line = part.replace(/\s+/g, ' ').trim();
      const key = line.toLowerCase();
      if (!line || seen.has(key) || !isMeaningful(line)) continue;
      seen.add(key);
      kept.push(line);
      if (kept.length === MAX_LINES) break;
    }
    if (kept.length === MAX_LINES) break;
  }
  if (kept.length === 0) return null;

  let text = kept.join(', ');
  if (text.length > MAX_CHARS) {
    const cut = text.lastIndexOf(' ', MAX_CHARS);
    text = text.slice(0, cut > 0 ? cut : MAX_CHARS);
  }
  return text;
}
