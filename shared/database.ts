// Contract of the anime database browser (/api/anime, /api/anime/facets, /api/anime/detail), shared by server and UI.
import type { Difficulty, GenreType } from './catalog';
import type { Mode } from './modes';

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

/** One MAL entry merged into a show (its seasons, movies, OVAs, remakes…). */
export interface DbEntry {
  malId: number;
  title: string;
  mediaType: string | null;
  year: number | null;
  episodes: number | null;
}

/** The OP or ED the Opening/Ending modes play for a show. */
export interface DbSong {
  /** AnimeThemes slug, e.g. OP1. */
  label: string | null;
  title: string | null;
  artist: string | null;
  /** The full song (AnimeThemes). */
  audio: string;
  /** The game's pre-blurred, muted clue clip, when the pipeline made one. */
  clip: string | null;
}

/** A character Character mode can ask for a show. */
export interface DbCharacter {
  id: number;
  name: string;
  /** Romaji nicknames, also accepted as the name. */
  nicknames: string[];
  role: string | null;
  favorites: number | null;
  /** Character mode's difficulty for this character (from its own MAL favorites). */
  difficulty: Difficulty;
  portrait: string;
  /** Other shows Character mode also accepts as this character's anime (they appear there too). */
  alsoIn: Array<{ malId: number; title: string }>;
}

/** The clues as the game shows them. */
export interface DbClues {
  /** The pre-blurred poster: Anidle's first clue, Ending's beside the video, both modes' fallback when the video fails. */
  poster: string | null;
  /** Anidle's second clue: the MAL synopsis with the title masked. */
  synopsis: string | null;
  /** Anidle's last clue: its two best-known characters. */
  characters: Array<{ name: string; portrait: string }>;
  /** Guess the Anime's title hint: each word's first letter. */
  titleHint: { title: string; english: string | null };
}

/** Everything about one show the game uses: GET /api/anime/detail?id= (any entry's id resolves to its show). */
export interface DbDetail extends DbItem {
  titleJa: string | null;
  synonyms: string[];
  mediaType: string | null;
  season: string | null;
  episodes: number | null;
  synopsis: string | null;
  /** The show's MAL entries, oldest first (only the show itself for a standalone title). */
  merged: DbEntry[];
  /** Modes this show can be asked in (it has the media they need). */
  modes: Mode[];
  songs: { op: DbSong | null; ed: DbSong | null };
  characters: DbCharacter[];
  /** Guess the Anime's frames from the opening, in the order they are shown. */
  screenshots: string[];
  clues: DbClues;
}
