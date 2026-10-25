// Pool rules shared by the pipeline and the API. See PLAN.md §5 and §12.

/** The 18 main MAL genres offered as a filter in unlimited mode (ids are MAL genre ids). */
export const MAIN_GENRES: ReadonlyArray<{ id: number; name: string }> = [
  { id: 1, name: 'Action' },
  { id: 2, name: 'Adventure' },
  { id: 5, name: 'Avant Garde' },
  { id: 46, name: 'Award Winning' },
  { id: 28, name: 'Boys Love' },
  { id: 4, name: 'Comedy' },
  { id: 8, name: 'Drama' },
  { id: 10, name: 'Fantasy' },
  { id: 26, name: 'Girls Love' },
  { id: 47, name: 'Gourmet' },
  { id: 14, name: 'Horror' },
  { id: 7, name: 'Mystery' },
  { id: 22, name: 'Romance' },
  { id: 24, name: 'Sci-Fi' },
  { id: 36, name: 'Slice of Life' },
  { id: 30, name: 'Sports' },
  { id: 37, name: 'Supernatural' },
  { id: 41, name: 'Suspense' },
];

/** The popular pool: MAL's popularity ranking down to this many members (~3.700 titles in Oct 2026). */
export const POPULAR_MIN_MEMBERS = 50_000;

// Difficulty by MAL members (Oct 2026: ~540 easy, ~890 medium among the popular pool).
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];
export const EASY_MIN_MEMBERS = 500_000;
export const MEDIUM_MIN_MEMBERS = 200_000;
export const DIFFICULTY_LABELS: Record<Difficulty, string> = {
  easy: 'Easy (≥ 500 rb member)',
  medium: 'Medium (200–500 rb member)',
  hard: 'Hard (< 200 rb member)',
};
/** The daily puzzle should be fair for everyone: no obscure titles. */
export const DAILY_DIFFICULTIES: readonly Difficulty[] = ['easy', 'medium'];

export function difficultyOf(members: number | null): Difficulty {
  if (members != null && members >= EASY_MIN_MEMBERS) return 'easy';
  if (members != null && members >= MEDIUM_MIN_MEMBERS) return 'medium';
  return 'hard';
}

/** Explicit genres that keep a title out of every pool: Hentai, Erotica. */
export const EXCLUDED_GENRE_IDS: ReadonlySet<number> = new Set([12, 49]);
/** MAL media types that make no sense in a quiz. */
export const EXCLUDED_MEDIA_TYPES: Record<string, true> = { music: true, cm: true, pv: true, unknown: true };

export type GenreType = 'genres' | 'explicit_genres' | 'themes' | 'demographics';

export const POOLS = ['semua', 'teman', 'bareng', 'saya', 'populer'] as const;
export type Pool = (typeof POOLS)[number];

export const POOL_LABELS: Record<Pool, string> = {
  semua: 'Semua (completed teman + populer)',
  teman: 'Completed minimal 1 teman',
  bareng: 'Completed semua teman',
  saya: 'Completed saya',
  populer: 'Populer di MAL (≥ 50 rb member)',
};

/** Pools built from MAL completed lists: only accounts with a linked MAL account may play them. */
export const POOL_NEEDS_MAL: Record<Pool, boolean> = { semua: false, teman: true, bareng: true, saya: true, populer: false };

export const ANIDLE_MAX_GUESSES = 10;

/** Why a title can never be a puzzle answer, or null when it can. Unaired titles return once they air (next enrich). */
export function exclusionReason(mediaType: string | null, genreIds: Iterable<number>, status: string | null = null): string | null {
  if (!mediaType || EXCLUDED_MEDIA_TYPES[mediaType]) return `media_type:${mediaType ?? 'none'}`;
  for (const id of genreIds) if (EXCLUDED_GENRE_IDS.has(id)) return `genre:${id}`;
  if (status === 'not_yet_aired') return 'status:not_yet_aired';
  return null;
}
