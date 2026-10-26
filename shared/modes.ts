// Game modes and the rules of the multi-round modes (PLAN.md §8).
import type { Difficulty } from './catalog.js';

/** Daily puzzles roll over at 00:00 WIB (UTC+7). */
export const WIB_OFFSET_MS = 7 * 3_600_000;

/** Today's date in WIB, YYYY-MM-DD: the date of the daily puzzles. */
export function todayWib(now = Date.now()): string {
  return new Date(now + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

/** The first daily puzzles; the archive (playing an earlier day) goes back to here. */
export const FIRST_DAILY_DATE = '2026-10-25';

/** `date` (YYYY-MM-DD) shifted by `days`. */
export const shiftDate = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

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

/** Every mode's puzzle is worth MODE_MAX_POINTS, so a day's five daily puzzles make DAILY_MAX_POINTS (100,000). */
export const MODE_MAX_POINTS = 20_000;
export const DAILY_MAX_POINTS = MODE_MAX_POINTS * MODES.length;

/** Round modes: round 1 (easy) 30 % of the mode, rounds 2–3 (medium) 35 % each: 6,000 / 7,000 / 7,000. */
export const ROUND_MAX_POINTS: readonly number[] = [(MODE_MAX_POINTS * 3) / 10, (MODE_MAX_POINTS * 7) / 20, (MODE_MAX_POINTS * 7) / 20];

/** Song modes: one guess; right = the round's points, half of them after opening the clue (the blurred music video); a miss scores 0. */
export const SONG_CLUE_SHARE = 0.5;

/** Screenshot: one guess; right = the round's points minus this share per clue opened; a miss scores 0. */
export const SCREENSHOT_CLUE_COST = 0.25;

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

