// Game modes and the rules of the multi-round modes (PLAN.md §8).
import type { Difficulty } from './catalog.js';

/** Daily puzzles roll over at 00:00 UTC+7. */
export const DAILY_UTC_OFFSET_MS = 7 * 3_600_000;

/** Today's date in UTC+7, YYYY-MM-DD: the date of the daily puzzles. */
export function todayUtc7(now = Date.now()): string {
  return new Date(now + DAILY_UTC_OFFSET_MS).toISOString().slice(0, 10);
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

/** anime_media.kind: media the pipeline copied to R2 for a title. Songs live in anime_theme (SONG_KIND). */
export const MEDIA_KINDS = ['cover', 'chars', 'shots'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** anime_theme.kind: an opening or an ending of one MAL entry. */
export type ThemeKind = 'op' | 'ed';

/** The songs a song mode plays: a title qualifies when one of its entries has an ok theme of this kind. */
export const SONG_KIND: Record<SongMode, ThemeKind> = { opening: 'op', ending: 'ed' };

/** anime_media.status. Pools use ok only; rejected = turned down by an admin. */
export const MEDIA_STATUSES = ['ok', 'missing', 'broken', 'rejected'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const isRoundMode = (mode: Mode): mode is RoundMode => mode === 'screenshot';
export const isSongMode = (mode: Mode): mode is SongMode => mode === 'opening' || mode === 'ending';

/** What a title needs to be asked in the other modes (Anidle needs nothing); song modes need a theme of SONG_KIND. */
export const MODE_MEDIA: Record<Exclude<Mode, SongMode>, Exclude<MediaKind, 'cover'> | null> = { anidle: null, screenshot: 'shots', character: 'chars' };

export const ROUND_COUNT = 3;

/** Screenshots per title: the first is shown, the others are clues. */
export const SCREENSHOTS_PER_TITLE = 3;

/**
 * Screenshot clues, opened on demand in this order: the 2nd and 3rd screenshot, then the title masked
 * to its initials (N_____, plus the English title when it has one).
 */
export const SCREENSHOT_CLUES = ['shot', 'shot', 'title'] as const;

/**
 * What each mode's puzzle is worth; a day's five daily puzzles add up to DAILY_MAX_POINTS (100,000).
 * Guess the Anime and Character weigh most (three rounds of 10,000), Opening and Ending three rounds
 * of 5,000, Anidle one puzzle of 10,000.
 */
export const MODE_MAX_POINTS: Record<Mode, number> = { anidle: 10_000, opening: 15_000, ending: 15_000, character: 30_000, screenshot: 30_000 };
export const DAILY_MAX_POINTS = MODES.reduce((sum, mode) => sum + MODE_MAX_POINTS[mode], 0);

/** A round of a three-round mode: an equal share of the mode's points, whatever its difficulty. */
export const roundMaxPoints = (mode: Exclude<Mode, 'anidle'>) => MODE_MAX_POINTS[mode] / ROUND_COUNT;

/** Song modes: one guess; right = the round's points, half of them after opening the clue (the blurred music video); a miss scores 0. */
export const SONG_CLUE_SHARE = 0.5;

/** Screenshot: one guess; right = the round's points minus this share per clue opened; a miss scores 0. */
export const SCREENSHOT_CLUE_COST = 0.25;

/** The difficulty of each round of a puzzle drawn from every difficulty (the daily Opening, Ending, Guess the Anime). */
const ROUND_STAGES: readonly Difficulty[] = ['easy', 'medium', 'hard'];

/**
 * Difficulty of each round of a multi-round puzzle: easy, medium, hard when the pool is every
 * difficulty; easy, medium, medium for easy + medium. A pool narrowed any other way keeps its
 * difficulties for every round.
 */
export function roundDifficulties(pool: readonly Difficulty[], round: number): readonly Difficulty[] {
  if (pool.length === 0) return [ROUND_STAGES[Math.min(round, ROUND_STAGES.length - 1)]!];
  if (pool.length === 2 && pool.includes('easy') && pool.includes('medium')) return round === 0 ? ['easy'] : ['medium'];
  return pool;
}

/**
 * The slices a round draws from, in order, when the first is too small (media still being copied).
 * Rounds after the first never fall back to easy: a hard round widens to medium + hard, a medium one to
 * medium + hard. Only when the pool has no such title at all does it take the whole pool.
 */
export function roundTries(pool: readonly Difficulty[], round: number): ReadonlyArray<readonly Difficulty[]> {
  const staged = roundDifficulties(pool, round);
  if (staged === pool) return [pool];
  const widened = round === 0 ? pool : (pool.length ? pool : ROUND_STAGES).filter((d) => d !== 'easy');
  const tries = [staged, widened, pool];
  return tries.filter((t, i) => tries.findIndex((u) => u.join() === t.join()) === i);
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

