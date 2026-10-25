// Pool rules shared by the pipeline and the API. See PLAN.md §5 and §12.

/** The 18 main MAL genres used for "top 100 per genre" (ids are MAL genre ids). */
export const TOP_GENRES: ReadonlyArray<{ id: number; name: string }> = [
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

export const TOP_PER_GENRE = 100;
export const TOP_MIN_MEMBERS = 30_000;

/** Explicit genres that keep a title out of every pool: Hentai, Erotica. */
export const EXCLUDED_GENRE_IDS: ReadonlySet<number> = new Set([12, 49]);
/** MAL media types that make no sense in a quiz. */
export const EXCLUDED_MEDIA_TYPES: Record<string, true> = { music: true, cm: true, pv: true, unknown: true };

export type GenreType = 'genres' | 'explicit_genres' | 'themes' | 'demographics';

export const POOLS = ['semua', 'teman', 'bareng', 'saya', 'top'] as const;
export type Pool = (typeof POOLS)[number];

export const POOL_LABELS: Record<Pool, string> = {
  semua: 'Semua (completed teman + top genre)',
  teman: 'Completed minimal 1 teman',
  bareng: 'Completed semua teman',
  saya: 'Completed saya',
  top: 'Top 100 per genre',
};

/** Pools built from MAL completed lists: only accounts with a linked MAL account may play them. */
export const POOL_NEEDS_MAL: Record<Pool, boolean> = { semua: false, teman: true, bareng: true, saya: true, top: false };

export const ANIDLE_MAX_GUESSES = 10;

/** Why a title can never be a puzzle answer, or null when it can. */
export function exclusionReason(mediaType: string | null, genreIds: Iterable<number>): string | null {
  if (!mediaType || EXCLUDED_MEDIA_TYPES[mediaType]) return `media_type:${mediaType ?? 'none'}`;
  for (const id of genreIds) if (EXCLUDED_GENRE_IDS.has(id)) return `genre:${id}`;
  return null;
}
