import { CANONICAL_SQL, difficultyOf, type GenreType } from '../shared/catalog.js';
import { DB_PAGE_SIZE, type DbFacets, type DbFilters, type DbItem, type DbPage, type DbSort } from '../shared/database.js';
import { all, one } from './db.js';
import { DIFFICULTY_SQL } from './game.js';
import { COVER_KEY_SQL, coverOf } from './media.js';

const ORDER_BY: Record<DbSort, string> = {
  popularity: 'a.members IS NULL, a.members DESC',
  score: 'a.score IS NULL, a.score DESC',
  newest: 'a.start_date IS NULL, a.start_date DESC',
  oldest: 'a.start_date IS NULL, a.start_date ASC',
  title: 'a.title COLLATE NOCASE ASC',
};

function where(f: DbFilters): { sql: string; args: Array<string | number> } {
  const parts = ['a.excluded IS NULL', CANONICAL_SQL];
  const args: Array<string | number> = [];
  if (f.q) {
    // Synonyms are a JSON array of strings; a LIKE over its text is enough for a search box. Any
    // entry of the show may match: searching "Season 2" finds the show it was merged into.
    const like = `%${f.q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const columns = ['x.title', 'x.title_en', 'x.title_ja', 'x.synonyms'];
    parts.push(
      `EXISTS (SELECT 1 FROM anime x WHERE (x.mal_id = a.mal_id OR x.canonical_id = a.mal_id) AND (${columns.map((c) => `${c} LIKE ? ESCAPE '\\'`).join(' OR ')}))`,
    );
    args.push(...columns.map(() => like));
  }
  for (const id of f.genres) {
    parts.push('EXISTS (SELECT 1 FROM anime_genre g WHERE g.mal_id = a.mal_id AND g.genre_id = ?)');
    args.push(id);
  }
  if (f.studio) {
    parts.push('EXISTS (SELECT 1 FROM json_each(a.studios) s WHERE s.value = ?)');
    args.push(f.studio);
  }
  if (f.source) {
    parts.push('a.source = ?');
    args.push(f.source);
  }
  if (f.difficulty) parts.push(`(${DIFFICULTY_SQL[f.difficulty]})`);
  return { sql: parts.join(' AND '), args };
}

interface Row {
  mal_id: number;
  title: string;
  title_en: string | null;
  cover_src: string | null;
  cover_key: string | null;
  year: number | null;
  score: number | null;
  members: number | null;
  rank: number | null;
  source: string | null;
  studios: string;
  entries: number;
}

const num = (v: number | null) => (v == null ? null : Number(v));

export async function listAnime(f: DbFilters): Promise<DbPage> {
  const w = where(f);
  const total = Number((await one<{ n: number }>(`SELECT COUNT(*) AS n FROM anime a WHERE ${w.sql}`, w.args))?.n ?? 0);
  const rows = await all<Row>(
    `SELECT a.mal_id, a.title, a.title_en, a.cover_src, ${COVER_KEY_SQL} AS cover_key, a.year, a.score, a.members, p.rank, a.source, a.studios,
            (SELECT COUNT(*) FROM anime x WHERE x.canonical_id = a.mal_id AND x.excluded IS NULL) AS entries
     FROM anime a LEFT JOIN popular p ON p.mal_id = a.mal_id
     WHERE ${w.sql} ORDER BY ${ORDER_BY[f.sort]}, a.mal_id LIMIT ? OFFSET ?`,
    [...w.args, DB_PAGE_SIZE, (f.page - 1) * DB_PAGE_SIZE],
  );
  const ids = rows.map((r) => Number(r.mal_id));
  const genreRows = ids.length
    ? await all<{ mal_id: number; id: number; name: string; type: GenreType }>(
        `SELECT ag.mal_id, g.id, g.name, g.type FROM anime_genre ag JOIN genre g ON g.id = ag.genre_id
         WHERE ag.mal_id IN (${ids.map(() => '?').join(',')}) ORDER BY g.name`,
        ids,
      )
    : [];
  const genresOf = Map.groupBy(genreRows, (g) => Number(g.mal_id));
  const items: DbItem[] = rows.map((r) => ({
    malId: Number(r.mal_id),
    title: r.title,
    titleEn: r.title_en,
    cover: coverOf(r.cover_key, r.cover_src),
    year: num(r.year),
    score: num(r.score),
    members: num(r.members),
    popularityRank: num(r.rank),
    entries: Math.max(1, Number(r.entries)),
    difficulty: difficultyOf(num(r.members)),
    source: r.source,
    studios: JSON.parse(r.studios) as string[],
    genres: (genresOf.get(Number(r.mal_id)) ?? []).map((g) => ({ id: Number(g.id), name: g.name, type: g.type })),
  }));
  return { items, total, page: f.page, pageSize: DB_PAGE_SIZE };
}

/** Filter options with how many shows each has. */
export async function facets(): Promise<DbFacets> {
  const [genres, studios, sources] = await Promise.all([
    all<{ id: number; name: string; type: GenreType; count: number }>(
      `SELECT g.id, g.name, g.type, COUNT(*) AS count FROM anime_genre ag
       JOIN genre g ON g.id = ag.genre_id JOIN anime a ON a.mal_id = ag.mal_id
       WHERE a.excluded IS NULL AND ${CANONICAL_SQL} GROUP BY g.id ORDER BY g.name`,
    ),
    all<{ name: string; count: number }>(
      `SELECT s.value AS name, COUNT(*) AS count FROM anime a, json_each(a.studios) s
       WHERE a.excluded IS NULL AND ${CANONICAL_SQL} GROUP BY s.value ORDER BY count DESC, name`,
    ),
    all<{ value: string; count: number }>(
      `SELECT source AS value, COUNT(*) AS count FROM anime a WHERE a.excluded IS NULL AND ${CANONICAL_SQL} AND source IS NOT NULL GROUP BY source ORDER BY count DESC`,
    ),
  ]);
  return {
    genres: genres.map((g) => ({ id: Number(g.id), name: g.name, type: g.type, count: Number(g.count) })),
    studios: studios.map((s) => ({ name: s.name, count: Number(s.count) })),
    sources: sources.map((s) => ({ value: s.value, count: Number(s.count) })),
  };
}
