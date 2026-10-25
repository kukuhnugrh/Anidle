import { CHARACTERS_PER_TITLE } from './modes.js';
import { normalizeTitle } from './normalize.js';

// Character mode: every round shows CHARACTERS_PER_ROUND characters from different anime. For each
// one the player names the character and its anime, each with FIELD_TRIES tries.

export const FIELD_TRIES = 3;
export type CharacterField = 'name' | 'anime';

/** The character asked for a title: its best known one (anime_character slots go least → most favourited). */
export const CHARACTER_QUIZ_SLOT = CHARACTERS_PER_TITLE - 1;

/** Points for a field answered on try `index` (0-based); 4 characters × 125 = 500 per round. */
export const FIELD_POINTS: Record<CharacterField, readonly number[]> = {
  name: [75, 45, 15],
  anime: [50, 30, 10],
};

export interface CharacterNames {
  /** MAL list form, "Elric, Edward" (family name first), or a single name. */
  name: string;
  nicknames: readonly string[];
  nameKanji: string | null;
}

/** Romanisation is inconsistent (Ryou / Ryo / Ryō); fold long vowels after normalizeTitle. */
const fold = (s: string) => normalizeTitle(s).replace(/ou/g, 'o').replace(/uu/g, 'u').replace(/oo/g, 'o');

/** Every accepted spelling of a character: full name in either order, each name part, nicknames, kanji. */
export function characterAnswers(c: CharacterNames): Set<string> {
  const parts = c.name
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
  const out = new Set<string>();
  const add = (s: string | null | undefined) => {
    const f = s ? fold(s) : '';
    if (f.length >= 2) out.add(f);
  };
  add(parts.join(' '));
  add([...parts].reverse().join(' '));
  // A single part ("Edward", "Elric") is enough: the player still has to know which show it is.
  for (const word of parts.flatMap((p) => p.split(/\s+/))) if (fold(word).length >= 3) add(word);
  for (const n of c.nicknames) add(n);
  add(c.nameKanji);
  return out;
}

/** Levenshtein distance, stopping early once it exceeds `max`. */
function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, row[j]!);
    }
    if (best > max) return max + 1;
    prev = row;
  }
  return prev[b.length]!;
}

/** Whether a typed name means this character: exact on any accepted spelling, or one typo per 6 letters. */
export function matchesCharacter(guess: string, answers: ReadonlySet<string>): boolean {
  const g = fold(guess);
  if (g.length < 2) return false;
  if (answers.has(g)) return true;
  for (const a of answers) {
    const allowed = Math.floor(a.length / 6);
    if (allowed > 0 && distance(g, a, allowed) <= allowed) return true;
  }
  return false;
}
