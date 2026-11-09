// Spotting the anime's own title in OCR text read off a clue video's frames (step `titles`). OCR of
// stylized logos is rough ("ATTACK ON TITAN" read as "attack owetitanes"), so names match approximately.

/** Letters and digits only, case- and width-folded: "Steins;Gate" and "ＳＴＥＩＮＳ；ＧＡＴＥ" → steinsgate. */
export const titleKey = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');

const isCjk = (key: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(key);

/**
 * Names shorter than this are never searched: "K", "Mob" or "ID" turn up in any frame's noise. CJK names
 * pack more into each character ("鬼滅の刃").
 */
const MIN_LATIN = 5;
const MIN_CJK = 3;

/** Edits allowed in a name of this key: Latin one per 5 characters, CJK one per 6 (OCR noise there is random kanji). */
const allowedEdits = (key: string) => Math.floor(key.length / (isCjk(key) ? 6 : 5));

/** The searchable keys of a show's names, once each. */
export function titleKeys(names: Iterable<string | null | undefined>): string[] {
  const keys = new Set<string>();
  for (const name of names) {
    if (!name) continue;
    const key = titleKey(name);
    if (key.length >= (isCjk(key) ? MIN_CJK : MIN_LATIN)) keys.add(key);
  }
  return [...keys];
}

/** Fewest edits turning `pattern` into some substring of `text` (Sellers), stopping early past `max`. */
function substringDistance(pattern: string, text: string, max: number): number {
  const p = [...pattern];
  let prev = Array.from({ length: p.length + 1 }, (_, i) => i);
  let best = prev[p.length]!;
  for (const c of text) {
    const cur = [0];
    for (let i = 1; i <= p.length; i++) cur[i] = Math.min(prev[i]! + 1, cur[i - 1]! + 1, prev[i - 1]! + (p[i - 1] === c ? 0 : 1));
    best = Math.min(best, cur[p.length]!);
    if (best === 0) return 0;
    prev = cur;
  }
  return best <= max ? best : max + 1;
}

/** Whether a frame's OCR text shows any of the names (keys from titleKeys). */
export function showsTitle(ocrText: string, keys: readonly string[]): boolean {
  const text = titleKey(ocrText);
  return keys.some((key) => text.length >= key.length - allowedEdits(key) && substringDistance(key, text, allowedEdits(key)) <= allowedEdits(key));
}

/**
 * Seconds of video to hide from the seconds whose frame showed the title (frames are read once a second).
 * The card may start right after the previous frame and end right before the next one, and OCR misses
 * some frames of a card it reads in others, so each grows by `pad` on both sides; overlapping ones
 * merge. [start, end) pairs, ascending.
 */
export function hiddenSpans(seconds: readonly number[], pad = 1.5): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const t of [...seconds].sort((a, b) => a - b)) {
    const start = Math.max(0, t - pad);
    const end = t + pad;
    const last = spans.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else spans.push([start, end]);
  }
  return spans;
}
