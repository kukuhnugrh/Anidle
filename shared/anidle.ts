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
