import { DIFFICULTIES, type Difficulty } from '../../shared/catalog.js';
import { DB_MAX_GENRES, DB_SORTS, type DbSort } from '../../shared/database.js';
import { listAnime } from '../../server/database.js';
import { HttpError, json, route } from '../../server/http.js';

const text = (value: string | null, max = 100) => {
  const v = value?.trim();
  if (!v) return undefined;
  if (v.length > max) throw new HttpError(400, 'Parameter terlalu panjang.');
  return v;
};

/** Browse playable titles: ?q=&sort=&genre=1&genre=62&studio=&source=&type=&difficulty=&page= */
export const GET = route(async (req) => {
  const p = new URL(req.url).searchParams;
  const sort = p.get('sort') ?? 'popularity';
  if (!(sort in DB_SORTS)) throw new HttpError(400, `Sort tidak dikenal: ${sort}`);
  const genres = p.getAll('genre').map(Number);
  if (genres.some((g) => !Number.isInteger(g) || g <= 0) || genres.length > DB_MAX_GENRES) throw new HttpError(400, 'Filter genre tidak valid.');
  const difficulty = p.get('difficulty') || undefined;
  if (difficulty && !(DIFFICULTIES as readonly string[]).includes(difficulty)) throw new HttpError(400, `Difficulty tidak dikenal: ${difficulty}`);
  const page = Number(p.get('page') ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 1000) throw new HttpError(400, 'Halaman tidak valid.');

  const result = await listAnime({
    q: text(p.get('q')),
    sort: sort as DbSort,
    genres,
    studio: text(p.get('studio')),
    source: text(p.get('source'), 40),
    type: text(p.get('type'), 40),
    difficulty: difficulty as Difficulty | undefined,
    page,
  });
  // Same for everyone and only changes with the pipeline: let the CDN keep it briefly.
  return json(result, { headers: { 'cache-control': 'public, s-maxage=300, max-age=60' } });
});
