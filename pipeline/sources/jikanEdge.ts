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
