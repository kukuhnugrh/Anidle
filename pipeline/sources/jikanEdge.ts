import type { GenreType } from '../../shared/catalog.js';
import { optionalEnv } from '../../server/env.js';
import { getJson, Limiter } from '../limiter.js';

// jikan-edge enforces 30 req / 10 s and 60 req / 60 s per IP; stay under both.
export const jikanLimiter = new Limiter('jikan-edge', [
  { ms: 10_000, max: 25 },
  { ms: 60_000, max: 50 },
]);

const base = () => optionalEnv('JIKAN_BASE_URL', 'https://jikan.lucashdo.com');

export interface JikanGenre {
  malId: number;
  name: string;
  count: number;
  type: GenreType;
}

export async function animeGenres(): Promise<JikanGenre[]> {
  const res = await jikanLimiter.schedule(() => getJson<{ data: JikanGenre[] }>(`${base()}/v1/genres/anime`));
  return res.data;
}

export interface JikanSearchEntry {
  malId: number;
  title: string;
  type: string | null;
  score: number | null;
  members: number | null;
}

export interface SearchPage {
  entries: JikanSearchEntry[];
  hasNextPage: boolean;
}

/** One page (50 entries) of anime with a genre, best score first. */
export async function topByGenre(genreId: number, page: number): Promise<SearchPage> {
  const url = `${base()}/v1/anime?genres=${genreId}&order_by=score&sort=desc&page=${page}`;
  const res = await jikanLimiter.schedule(() => getJson<{ data: JikanSearchEntry[]; meta: { pagination?: { hasNextPage?: boolean } } }>(url));
  return { entries: res.data, hasNextPage: Boolean(res.meta.pagination?.hasNextPage) };
}
