import { ANIDLE_MAX_GUESSES } from './catalog.js';
import { MODE_MAX_POINTS } from './modes.js';

// Anidle: every guess is compared field by field with the answer.

export interface AnidleAnime {
  malId: number;
  title: string;
  year: number | null;
  score: number | null;
  source: string | null;
  studios: string[];
  genres: string[];
  /** MAL themes and demographics together (Isekai, School, Shounen…). */
  tags: string[];
  franchiseId: number | null;
}

/** Where the ANSWER lies relative to the guess: 'higher' = answer is bigger than what you guessed. */
export type Direction = 'equal' | 'higher' | 'lower' | 'unknown';
export type Overlap = 'full' | 'partial' | 'none';

export interface ScalarClue<T> {
  value: T;
  match: boolean;
}
export interface NumberClue {
  value: number | null;
  direction: Direction;
}
export interface ListClue {
  items: Array<{ name: string; hit: boolean }>;
  overlap: Overlap;
}

export interface AnidleFeedback {
  malId: number;
  title: string;
  /** Same title, or same prequel/sequel franchise. */
  correct: boolean;
  exact: boolean;
  year: NumberClue;
  score: NumberClue;
  source: ScalarClue<string | null>;
  studios: ListClue;
  genres: ListClue;
  tags: ListClue;
}

function direction(answer: number | null, guess: number | null, epsilon = 0): Direction {
  if (answer == null || guess == null) return 'unknown';
  if (Math.abs(answer - guess) <= epsilon) return 'equal';
  return answer > guess ? 'higher' : 'lower';
}

function list(answer: string[], guess: string[]): ListClue {
  const wanted = new Set(answer);
  const items = guess.map((name) => ({ name, hit: wanted.has(name) }));
  const hits = items.filter((i) => i.hit).length;
  // Both empty means "neither has any", which is a correct match.
  const full = hits === wanted.size && hits === guess.length;
  return { items, overlap: full ? 'full' : hits > 0 ? 'partial' : 'none' };
}

export function isCorrect(answer: Pick<AnidleAnime, 'malId' | 'franchiseId'>, guess: Pick<AnidleAnime, 'malId' | 'franchiseId'>): boolean {
  return guess.malId === answer.malId || (answer.franchiseId != null && guess.franchiseId === answer.franchiseId);
}

export function compareAnidle(answer: AnidleAnime, guess: AnidleAnime): AnidleFeedback {
  return {
    malId: guess.malId,
    title: guess.title,
    correct: isCorrect(answer, guess),
    exact: guess.malId === answer.malId,
    year: { value: guess.year, direction: direction(answer.year, guess.year) },
    score: { value: guess.score, direction: direction(answer.score, guess.score, 0.005) },
    source: { value: guess.source, match: guess.source === answer.source },
    studios: list(answer.studios, guess.studios),
    genres: list(answer.genres, guess.genres),
    tags: list(answer.tags, guess.tags),
  };
}

/** MODE_MAX_POINTS (20,000) for a first-try solve, one ANIDLE_MAX_GUESSES-th less per extra try (1,250 on the 16th), 0 when not solved. Skips count as tries. */
export function anidleScore(solved: boolean, guessCount: number): number {
  const step = MODE_MAX_POINTS / ANIDLE_MAX_GUESSES;
  return solved ? Math.max(step, MODE_MAX_POINTS - step * (guessCount - 1)) : 0;
}

/** Tries in order with each run of skipped ones (null) folded into one { skipped: n } entry. */
export function groupSkips<T extends AnidleFeedback>(tries: ReadonlyArray<T | null>): Array<T | { skipped: number }> {
  const out: Array<T | { skipped: number }> = [];
  for (const t of tries) {
    const last = out.at(-1);
    if (t) out.push(t);
    else if (last && 'skipped' in last) last.skipped++;
    else out.push({ skipped: 1 });
  }
  return out;
}

/**
 * Clues Anidle unlocks as tries pile up (wrong guesses or Skip): after 10 the blurred poster, after 13 the
 * synopsis, after 15 two characters (one try left). Skip jumps straight to the next one.
 */
export const ANIDLE_CLUES = [
  { kind: 'cover', after: 10 },
  { kind: 'synopsis', after: 13 },
  { kind: 'characters', after: 15 },
] as const;
export type AnidleClueKind = (typeof ANIDLE_CLUES)[number]['kind'];

const MASK = '▇▇▇';
/** Title words (4+ letters) common enough to appear in any synopsis without giving the title away: never masked on their own. */
const COMMON_WORDS: Record<string, true> = { with: true, from: true, that: true, this: true, your: true, into: true, over: true, season: true, part: true, movie: true, final: true, kara: true };

/**
 * A MAL synopsis made safe as a clue: the title's names (and their distinctive words, 4+ letters) are
 * masked, and MAL's source credit ("[Written by MAL Rewrite]", "(Source: …)") is dropped.
 */
export function maskSynopsis(text: string, names: readonly string[]): string {
  let out = text
    .replace(/\[Written by MAL Rewrite\]/gi, '')
    .replace(/\(Source:[^)]*\)/gi, '')
    .trim();
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const phrases = [...new Set(names.map((n) => n.trim()).filter((n) => n.length >= 3))].sort((a, b) => b.length - a.length);
  const words = [...new Set(names.flatMap((n) => n.split(/[^\p{L}\p{N}']+/u)).filter((w) => w.length >= 4 && !COMMON_WORDS[w.toLowerCase()]))];
  // "Titans", "Titan's": the plural or possessive of a title word gives it away just as well.
  for (const p of [...phrases, ...words]) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escape(p)}(?:'?s)?(?![\\p{L}\\p{N}])`, 'giu'), MASK);
  return out.replace(new RegExp(`${MASK}(?:[\\s:-]*${MASK})+`, 'g'), MASK);
}

// ------------------------------------------------------------------ summary of what the guesses revealed

export interface ScalarSummary {
  /** Set once a guess matched: the answer's value (may itself be null = unknown on MAL). */
  known: { value: string | null } | null;
  /** Values guessed that are not the answer (unknown/null guesses prove nothing and are left out). */
  ruledOut: string[];
}

export interface RangeSummary {
  exact: number | null;
  /** The answer is strictly greater than this. */
  above: number | null;
  /** The answer is strictly smaller than this. */
  below: number | null;
}

export interface ListSummary {
  /** Items the answer certainly has. */
  has: string[];
  /** Items the answer certainly does not have. */
  not: string[];
  /** A guess matched the whole list, so `has` is the answer's full list. */
  complete: boolean;
}

export interface AnidleSummary {
  year: RangeSummary;
  score: RangeSummary;
  source: ScalarSummary;
  studios: ListSummary;
  genres: ListSummary;
  tags: ListSummary;
}

function scalarSummary(clues: Array<ScalarClue<string | null>>): ScalarSummary {
  const hit = clues.find((c) => c.match);
  return {
    known: hit ? { value: hit.value } : null,
    ruledOut: [...new Set(clues.flatMap((c) => (!c.match && c.value != null ? [c.value] : [])))],
  };
}

function rangeSummary(clues: NumberClue[]): RangeSummary {
  const out: RangeSummary = { exact: null, above: null, below: null };
  for (const { value, direction } of clues) {
    if (value == null) continue;
    if (direction === 'equal') out.exact = value;
    if (direction === 'higher') out.above = Math.max(out.above ?? -Infinity, value);
    if (direction === 'lower') out.below = Math.min(out.below ?? Infinity, value);
  }
  return out;
}

function listSummary(clues: ListClue[]): ListSummary {
  const has = new Set<string>();
  const not = new Set<string>();
  for (const clue of clues) for (const item of clue.items) (item.hit ? has : not).add(item.name);
  return { has: [...has].sort(), not: [...not].sort(), complete: clues.some((c) => c.overlap === 'full') };
}

/** Everything the guesses so far proved about the answer. */
export function summarizeAnidle(guesses: AnidleFeedback[]): AnidleSummary {
  return {
    year: rangeSummary(guesses.map((g) => g.year)),
    score: rangeSummary(guesses.map((g) => g.score)),
    source: scalarSummary(guesses.map((g) => g.source)),
    studios: listSummary(guesses.map((g) => g.studios)),
    genres: listSummary(guesses.map((g) => g.genres)),
    tags: listSummary(guesses.map((g) => g.tags)),
  };
}
