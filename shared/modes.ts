// Game modes and the rules of the multi-round modes (PLAN.md §8).

/** Daily puzzles roll over at 00:00 WIB (UTC+7). */
export const WIB_OFFSET_MS = 7 * 3_600_000;

/** Today's date in WIB, YYYY-MM-DD: the date of the daily puzzles. */
export function todayWib(now = Date.now()): string {
  return new Date(now + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

export const MODES = ['anidle', 'opening', 'ending', 'character'] as const;
export type Mode = (typeof MODES)[number];
/** Modes played as ROUND_COUNT rounds, each revealing more media per attempt. */
export type RoundMode = Exclude<Mode, 'anidle'>;

export const MODE_LABELS: Record<Mode, string> = { anidle: 'Anidle', opening: 'Opening', ending: 'Ending', character: 'Karakter' };

/** anime_media.kind: what the pipeline copied to R2 for a title. */
export type MediaKind = 'cover' | 'op' | 'ed' | 'chars';

export const isRoundMode = (mode: Mode): mode is RoundMode => mode !== 'anidle';

export const ROUND_COUNT = 3;

/**
 * Per round mode: the media a title needs, and what each attempt unlocks. Song modes unlock seconds
 * of the clip; Karakter unlocks portraits (slot 0 first, the most popular character last).
 */
export const ROUND_MODES: Record<RoundMode, { media: Exclude<MediaKind, 'cover'>; stages: readonly number[] }> = {
  opening: { media: 'op', stages: [1, 3, 6, 12, 30] },
  ending: { media: 'ed', stages: [1, 3, 6, 12, 30] },
  character: { media: 'chars', stages: [1, 2, 3, 4] },
};

export const CHARACTERS_PER_TITLE = 4;

export const MAX_ROUND_POINTS = 500;

/** Points for a round solved on attempt `solvedAt` (0-based) out of `stages`; unsolved = 0. 5 stages: 500/400/300/200/100. */
export function roundPoints(solvedAt: number | null, stages: number): number {
  return solvedAt == null || solvedAt >= stages ? 0 : Math.round((MAX_ROUND_POINTS * (stages - solvedAt)) / stages);
}
