// Game modes and the rules of the multi-round modes (PLAN.md §8).
import type { Difficulty } from './catalog.js';

/** Daily puzzles roll over at 00:00 WIB (UTC+7). */
export const WIB_OFFSET_MS = 7 * 3_600_000;

/** Today's date in WIB, YYYY-MM-DD: the date of the daily puzzles. */
export function todayWib(now = Date.now()): string {
  return new Date(now + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

export const MODES = ['anidle', 'opening', 'ending', 'character', 'screenshot'] as const;
export type Mode = (typeof MODES)[number];
/** Song modes: one title per round, the full song plays, one guess, an optional blurred clue. */
export type SongMode = 'opening' | 'ending';
/** Clue modes: one title per round, one guess, clues opened on demand (Screenshot). */
export type RoundMode = 'screenshot';

export const MODE_LABELS: Record<Mode, string> = { anidle: 'Anidle', opening: 'Opening', ending: 'Ending', character: 'Character', screenshot: 'Guess the Anime' };

/** anime_media.kind: media the pipeline found or copied to R2 for a title (op/ed: the AnimeThemes source). */
export const MEDIA_KINDS = ['cover', 'op', 'ed', 'chars', 'shots'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** anime_media.status. Pools use ok only; rejected = turned down by an admin. */
export const MEDIA_STATUSES = ['ok', 'missing', 'broken', 'rejected'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const isRoundMode = (mode: Mode): mode is RoundMode => mode === 'screenshot';
export const isSongMode = (mode: Mode): mode is SongMode => mode === 'opening' || mode === 'ending';

/** What a title needs to be asked in a mode (Anidle needs nothing). */
export const MODE_MEDIA: Record<Mode, Exclude<MediaKind, 'cover'> | null> = { anidle: null, opening: 'op', ending: 'ed', screenshot: 'shots', character: 'chars' };

export const ROUND_COUNT = 3;

/** Screenshots per title: the first is shown, the others are clues. */
export const SCREENSHOTS_PER_TITLE = 3;

/**
 * Screenshot clues, opened on demand in this order: the 2nd and 3rd screenshot, then the title masked
 * to its initials (N_____, plus the English title when it has one).
 */
export const SCREENSHOT_CLUES = ['shot', 'shot', 'title'] as const;

/** Screenshot: one guess per round; right = 500 minus 125 per clue opened, wrong or given up = 0. */
export const SCREENSHOT_POINTS = { max: 500, perClue: 125 } as const;

/** Song modes: a right guess scores 500, or 250 after opening the clue (blurred OP video / blurred cover); a miss scores 0. */
export const SONG_POINTS = { plain: 500, withClue: 250 } as const;

/**
 * Difficulty of each round of a multi-round puzzle: round 1 easy, the rest medium, when the pool is
 * every difficulty or easy + medium (the daily puzzles). A pool narrowed any other way keeps its
 * difficulties for every round.
 */
export function roundDifficulties(pool: readonly Difficulty[], round: number): readonly Difficulty[] {
  const staged = pool.length === 0 || (pool.length === 2 && pool.includes('easy') && pool.includes('medium'));
  if (!staged) return pool;
  return round === 0 ? ['easy'] : ['medium'];
}

/** Character mode: characters per round, each from a different anime. */
export const CHARACTERS_PER_ROUND = 4;

/** play.solved of a perfect puzzle: Anidle solved, every round, or every character (name + anime). */
export const PERFECT_SOLVED: Record<Mode, number> = {
  anidle: 1,
  opening: ROUND_COUNT,
  ending: ROUND_COUNT,
  screenshot: ROUND_COUNT,
  character: ROUND_COUNT * CHARACTERS_PER_ROUND,
};

export const CHARACTERS_PER_TITLE = 4;

export const MAX_ROUND_POINTS = 500;
