// Anidle: every guess is compared field by field with the answer.

export interface AnidleAnime {
  malId: number;
  title: string;
  mediaType: string | null;
  year: number | null;
  season: string | null;
  episodes: number | null;
  score: number | null;
  source: string | null;
  studios: string[];
  genres: string[];
  themes: string[];
  demographics: string[];
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
  mediaType: ScalarClue<string | null>;
  year: NumberClue;
  season: ScalarClue<string | null>;
  episodes: NumberClue;
  score: NumberClue;
  source: ScalarClue<string | null>;
  studios: ListClue;
  genres: ListClue;
  themes: ListClue;
  demographics: ListClue;
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
    mediaType: { value: guess.mediaType, match: guess.mediaType === answer.mediaType },
    year: { value: guess.year, direction: direction(answer.year, guess.year) },
    season: { value: guess.season, match: guess.season != null && guess.season === answer.season },
    episodes: { value: guess.episodes, direction: direction(answer.episodes, guess.episodes) },
    score: { value: guess.score, direction: direction(answer.score, guess.score, 0.005) },
    source: { value: guess.source, match: guess.source === answer.source },
    studios: list(answer.studios, guess.studios),
    genres: list(answer.genres, guess.genres),
    themes: list(answer.themes, guess.themes),
    demographics: list(answer.demographics, guess.demographics),
  };
}

/** 1000 for a first-try solve, -100 per extra guess, 0 when not solved. */
export function anidleScore(solved: boolean, guessCount: number): number {
  return solved ? Math.max(100, 1000 - 100 * (guessCount - 1)) : 0;
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
  mediaType: ScalarSummary;
  year: RangeSummary;
  season: ScalarSummary;
  episodes: RangeSummary;
  score: RangeSummary;
  source: ScalarSummary;
  studios: ListSummary;
  genres: ListSummary;
  themes: ListSummary;
  demographics: ListSummary;
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
    mediaType: scalarSummary(guesses.map((g) => g.mediaType)),
    year: rangeSummary(guesses.map((g) => g.year)),
    season: scalarSummary(guesses.map((g) => g.season)),
    episodes: rangeSummary(guesses.map((g) => g.episodes)),
    score: rangeSummary(guesses.map((g) => g.score)),
    source: scalarSummary(guesses.map((g) => g.source)),
    studios: listSummary(guesses.map((g) => g.studios)),
    genres: listSummary(guesses.map((g) => g.genres)),
    themes: listSummary(guesses.map((g) => g.themes)),
    demographics: listSummary(guesses.map((g) => g.demographics)),
  };
}
