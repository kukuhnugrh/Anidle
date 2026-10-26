// Contract of the anime database browser (/api/anime, /api/anime/facets), shared by server and UI.
import type { Difficulty, GenreType } from './catalog';

export const DB_SORTS = {
  popularity: 'Popularity (most members)',
  score: 'Highest score',
  newest: 'Newest year',
  oldest: 'Oldest year',
  title: 'Title A–Z',
} as const;
export type DbSort = keyof typeof DB_SORTS;

export const DB_PAGE_SIZE = 48;
/** Genre and tag filters share MAL genre ids; this caps how many may be combined (AND). */
export const DB_MAX_GENRES = 6;

export interface DbFilters {
  q?: string;
  sort: DbSort;
  /** MAL genre ids of any type (genre, theme, demographic = tag); the title must have all of them. */
  genres: number[];
  studio?: string;
  source?: string;
  difficulty?: Difficulty;
  page: number;
}

export interface DbGenre {
  id: number;
  name: string;
  type: GenreType;
}

export interface DbItem {
  malId: number;
  title: string;
  titleEn: string | null;
  cover: string | null;
  year: number | null;
  score: number | null;
  members: number | null;
  /** MAL popularity rank, when the title is in the popular pool. */
  popularityRank: number | null;
  /** Seasons, movies, OVAs… merged into this show (1 = a standalone title). */
  entries: number;
  difficulty: Difficulty;
  source: string | null;
  studios: string[];
  genres: DbGenre[];
}

export interface DbPage {
  items: DbItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DbFacets {
  genres: Array<DbGenre & { count: number }>;
  studios: Array<{ name: string; count: number }>;
  sources: Array<{ value: string; count: number }>;
}
