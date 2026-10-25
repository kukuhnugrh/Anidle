// Game modes and the rules of the multi-round song modes (PLAN.md §8).

/** Daily puzzles roll over at 00:00 WIB (UTC+7). */
export const WIB_OFFSET_MS = 7 * 3_600_000;

/** Today's date in WIB, YYYY-MM-DD: the date of the daily puzzles. */
export function todayWib(now = Date.now()): string {
  return new Date(now + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

export const MODES = ['anidle', 'opening', 'ending'] as const;
export type Mode = (typeof MODES)[number];
export type ThemeMode = Exclude<Mode, 'anidle'>;

export const MODE_LABELS: Record<Mode, string> = { anidle: 'Anidle', opening: 'Opening', ending: 'Ending' };

/** The media kind (anime_media.kind) a song mode plays. */
export const THEME_MEDIA: Record<ThemeMode, 'op' | 'ed'> = { opening: 'op', ending: 'ed' };

export const isThemeMode = (mode: Mode): mode is ThemeMode => mode !== 'anidle';

export const THEME_ROUNDS = 3;

/** Seconds of the clip unlocked per attempt: each wrong guess or skip opens the next stage. */
export const CLIP_STAGES: readonly number[] = [1, 3, 6, 12, 30];

/** Points for a round solved on attempt `index` (0-based); a round that runs out of attempts scores 0. */
export const ROUND_POINTS: readonly number[] = [500, 400, 300, 200, 100];

export function roundPoints(solvedAt: number | null): number {
  return solvedAt == null ? 0 : (ROUND_POINTS[solvedAt] ?? 0);
}
