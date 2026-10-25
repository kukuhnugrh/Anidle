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
/** Modes played as ROUND_COUNT rounds of one title each, revealing more media per attempt. */
export type RoundMode = 'opening' | 'ending' | 'screenshot';

export const MODE_LABELS: Record<Mode, string> = { anidle: 'Anidle', opening: 'Opening', ending: 'Ending', character: 'Character', screenshot: 'Screenshot' };

/** anime_media.kind: what the pipeline copied to R2 for a title. */
export const MEDIA_KINDS = ['cover', 'op', 'ed', 'chars', 'shots'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];

/** anime_media.status. Pools use ok only; rejected = turned down by an admin. */
export const MEDIA_STATUSES = ['ok', 'missing', 'broken', 'rejected'] as const;
export type MediaStatus = (typeof MEDIA_STATUSES)[number];

export const isRoundMode = (mode: Mode): mode is RoundMode => mode === 'opening' || mode === 'ending' || mode === 'screenshot';

/** What a title needs in R2 to be asked in a mode (Anidle needs nothing). */
export const MODE_MEDIA: Record<Mode, Exclude<MediaKind, 'cover'> | null> = { anidle: null, opening: 'op', ending: 'ed', screenshot: 'shots', character: 'chars' };

export const ROUND_COUNT = 3;

/**
 * Per round mode, what each attempt unlocks: song modes unlock seconds of the clip; Screenshot zooms
 * out of one frame of the opening (4× crop → full frame).
 */
export const ROUND_STAGES: Record<RoundMode, readonly number[]> = {
  opening: [1, 3, 6, 12, 30],
  ending: [1, 3, 6, 12, 30],
  screenshot: [4, 2.5, 1.6, 1],
};

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

/** Points for a round solved on attempt `solvedAt` (0-based) out of `stages`; unsolved = 0. 5 stages: 500/400/300/200/100. */
export function roundPoints(solvedAt: number | null, stages: number): number {
  return solvedAt == null || solvedAt >= stages ? 0 : Math.round((MAX_ROUND_POINTS * (stages - solvedAt)) / stages);
}
