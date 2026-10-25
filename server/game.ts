import { randomUUID } from 'node:crypto';
import { anidleScore, compareAnidle, type AnidleAnime, type AnidleFeedback } from '../shared/anidle.js';
import { ANIDLE_MAX_GUESSES, POOLS, type GenreType, type Pool } from '../shared/catalog.js';
import type { TitleEntry } from '../shared/normalize.js';
import { seedOf } from './crypto.js';
import { all, nowIso, one, run } from './db.js';
import { HttpError } from './http.js';

export const MODES = ['anidle'] as const;
export type Mode = (typeof MODES)[number];

export interface PoolSpec {
  pool: Pool;
  username: string;
  genreId?: number;
}

/** SQL condition (on alias `a`) selecting the titles of a pool. Excluded titles never qualify. */
function poolWhere({ pool, username, genreId }: PoolSpec): { sql: string; args: Array<string | number> } {
  const inCompleted = 'EXISTS (SELECT 1 FROM completed c WHERE c.mal_id = a.mal_id)';
  const inTop = genreId
    ? 'EXISTS (SELECT 1 FROM top_genre t WHERE t.mal_id = a.mal_id AND t.genre_id = ?)'
    : 'EXISTS (SELECT 1 FROM top_genre t WHERE t.mal_id = a.mal_id)';
  const base = 'a.excluded IS NULL AND ';
  switch (pool) {
    case 'semua':
      return { sql: `${base}(${inCompleted} OR EXISTS (SELECT 1 FROM top_genre t WHERE t.mal_id = a.mal_id))`, args: [] };
    case 'teman':
      return { sql: base + inCompleted, args: [] };
    case 'saya':
      return { sql: `${base}EXISTS (SELECT 1 FROM completed c WHERE c.mal_id = a.mal_id AND c.username = ?)`, args: [username] };
    case 'bareng':
      return {
        sql: `${base}(SELECT COUNT(*) FROM completed c WHERE c.mal_id = a.mal_id) = (SELECT COUNT(DISTINCT username) FROM completed)
              AND EXISTS (SELECT 1 FROM completed)`,
        args: [],
      };
    case 'top':
      return { sql: base + inTop, args: genreId ? [genreId] : [] };
  }
}

export function parsePool(value: unknown): Pool {
  if (typeof value === 'string' && (POOLS as readonly string[]).includes(value)) return value as Pool;
  throw new HttpError(400, `Pool tidak dikenal: ${String(value)}`);
}

export async function poolIds(spec: PoolSpec): Promise<number[]> {
  const where = poolWhere(spec);
  const rows = await all<{ mal_id: number }>(`SELECT a.mal_id FROM anime a WHERE ${where.sql} ORDER BY a.mal_id`, where.args);
  return rows.map((r) => Number(r.mal_id));
}

/** Autocomplete list: every title of the widest pool, so no pool leaks which one is the answer. */
export async function titleEntries(): Promise<TitleEntry[]> {
  const where = poolWhere({ pool: 'semua', username: '' });
  const rows = await all<{ mal_id: number; title: string; title_en: string | null; title_ja: string | null; synonyms: string; year: number | null; media_type: string | null }>(
    `SELECT a.mal_id, a.title, a.title_en, a.title_ja, a.synonyms, a.year, a.media_type FROM anime a WHERE ${where.sql} ORDER BY a.members DESC`,
    where.args,
  );
  return rows.map((r) => ({
    id: Number(r.mal_id),
    names: [...new Set([r.title, r.title_en, r.title_ja, ...(JSON.parse(r.synonyms) as string[])].filter((n): n is string => Boolean(n)))],
    year: r.year == null ? null : Number(r.year),
    type: r.media_type,
  }));
}

interface AnimeRow {
  mal_id: number;
  title: string;
  media_type: string | null;
  year: number | null;
  season: string | null;
  num_episodes: number | null;
  score: number | null;
  source: string | null;
  studios: string;
  franchise_id: number | null;
  cover_src: string | null;
}

export async function loadAnidle(ids: number[]): Promise<Map<number, AnidleAnime & { cover: string | null }>> {
  if (!ids.length) return new Map();
  const marks = ids.map(() => '?').join(',');
  const rows = await all<AnimeRow>(
    `SELECT mal_id, title, media_type, year, season, num_episodes, score, source, studios, franchise_id, cover_src FROM anime WHERE mal_id IN (${marks})`,
    ids,
  );
  const genreRows = await all<{ mal_id: number; name: string; type: GenreType }>(
    `SELECT ag.mal_id, g.name, g.type FROM anime_genre ag JOIN genre g ON g.id = ag.genre_id WHERE ag.mal_id IN (${marks}) ORDER BY g.name`,
    ids,
  );
  const out = new Map<number, AnidleAnime & { cover: string | null }>();
  for (const r of rows) {
    out.set(Number(r.mal_id), {
      malId: Number(r.mal_id),
      title: r.title,
      mediaType: r.media_type,
      year: r.year == null ? null : Number(r.year),
      season: r.season,
      episodes: r.num_episodes == null ? null : Number(r.num_episodes),
      score: r.score == null ? null : Number(r.score),
      source: r.source,
      studios: JSON.parse(r.studios) as string[],
      genres: [],
      themes: [],
      demographics: [],
      franchiseId: r.franchise_id == null ? null : Number(r.franchise_id),
      cover: r.cover_src,
    });
  }
  for (const g of genreRows) {
    const anime = out.get(Number(g.mal_id));
    // Explicit genres (Ecchi) count as genres for the clue table.
    if (anime) (g.type === 'themes' ? anime.themes : g.type === 'demographics' ? anime.demographics : anime.genres).push(g.name);
  }
  return out;
}

// ------------------------------------------------------------------ puzzles

/** Today's date in WIB (UTC+7), YYYY-MM-DD: the daily puzzle rolls over at 00:00 WIB. */
export function todayWib(now = Date.now()): string {
  return new Date(now + 7 * 3_600_000).toISOString().slice(0, 10);
}

const RECENT_DAYS_WITHOUT_REPEAT = 60;

interface PuzzleRow {
  id: string;
  date: string | null;
  mode: Mode;
  pool: Pool;
  answer_id: number;
  created_by: string | null;
}

export async function dailyPuzzle(mode: Mode): Promise<PuzzleRow> {
  const date = todayWib();
  const existing = await one<PuzzleRow>('SELECT * FROM puzzle WHERE date = ? AND mode = ?', [date, mode]);
  if (existing) return existing;

  const ids = await poolIds({ pool: 'semua', username: '' });
  if (!ids.length) throw new HttpError(503, 'Pool masih kosong. Jalankan pipeline dulu.');
  const recent = new Set(
    (await all<{ answer_id: number }>('SELECT answer_id FROM puzzle WHERE mode = ? AND date IS NOT NULL ORDER BY date DESC LIMIT ?', [mode, RECENT_DAYS_WITHOUT_REPEAT])).map((r) =>
      Number(r.answer_id),
    ),
  );
  const candidates = ids.filter((id) => !recent.has(id));
  const from = candidates.length ? candidates : ids;
  const answer = from[Number(seedOf(`${date}:${mode}`) % BigInt(from.length))]!;

  // Concurrent first requests race here; UNIQUE(date, mode) keeps exactly one.
  await run('INSERT OR IGNORE INTO puzzle (id, date, mode, pool, answer_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), date, mode, 'semua', answer, nowIso()]);
  return (await one<PuzzleRow>('SELECT * FROM puzzle WHERE date = ? AND mode = ?', [date, mode]))!;
}

export async function unlimitedPuzzle(mode: Mode, spec: PoolSpec): Promise<PuzzleRow> {
  const ids = await poolIds(spec);
  if (!ids.length) throw new HttpError(404, 'Pool ini kosong.');
  const row: PuzzleRow = {
    id: randomUUID(),
    date: null,
    mode,
    pool: spec.pool,
    answer_id: ids[Math.floor(Math.random() * ids.length)]!,
    created_by: spec.username,
  };
  await run('INSERT INTO puzzle (id, date, mode, pool, answer_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
    row.id,
    row.date,
    row.mode,
    row.pool,
    row.answer_id,
    row.created_by,
    nowIso(),
  ]);
  return row;
}

export async function getPuzzle(id: string): Promise<PuzzleRow> {
  const row = await one<PuzzleRow>('SELECT * FROM puzzle WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Puzzle tidak ditemukan.');
  return row;
}

interface PlayRow {
  guesses: string;
  solved: number;
  score: number | null;
}

export interface PuzzleState {
  id: string;
  mode: Mode;
  date: string | null;
  pool: Pool;
  maxGuesses: number;
  guesses: AnidleFeedback[];
  solved: boolean;
  finished: boolean;
  score: number | null;
  /** Only once finished: the answer is never sent before that. */
  answer: { malId: number; title: string; cover: string | null; year: number | null } | null;
}

export async function puzzleState(puzzle: PuzzleRow, username: string): Promise<PuzzleState> {
  const play = await one<PlayRow>('SELECT guesses, solved, score FROM play WHERE puzzle_id = ? AND username = ?', [puzzle.id, username]);
  const guessIds = play ? (JSON.parse(play.guesses) as number[]) : [];
  const anime = await loadAnidle([Number(puzzle.answer_id), ...guessIds]);
  const answer = anime.get(Number(puzzle.answer_id));
  if (!answer) throw new HttpError(500, 'Data jawaban hilang dari database.');
  const guesses = guessIds.flatMap((id) => {
    const guess = anime.get(id);
    return guess ? [compareAnidle(answer, guess)] : [];
  });
  const solved = Boolean(play?.solved);
  const finished = solved || guesses.length >= ANIDLE_MAX_GUESSES;
  return {
    id: puzzle.id,
    mode: puzzle.mode,
    date: puzzle.date,
    pool: puzzle.pool,
    maxGuesses: ANIDLE_MAX_GUESSES,
    guesses,
    solved,
    finished,
    score: play?.score ?? null,
    answer: finished ? { malId: answer.malId, title: answer.title, cover: answer.cover, year: answer.year } : null,
  };
}

export async function submitGuess(puzzle: PuzzleRow, username: string, malId: number): Promise<PuzzleState> {
  const before = await puzzleState(puzzle, username);
  if (before.finished) throw new HttpError(409, 'Puzzle ini sudah selesai.');
  if (before.guesses.some((g) => g.malId === malId)) throw new HttpError(409, 'Judul itu sudah kamu tebak.');
  const known = await one<{ mal_id: number }>('SELECT mal_id FROM anime WHERE mal_id = ? AND excluded IS NULL', [malId]);
  if (!known) throw new HttpError(400, 'Judul itu tidak ada di pool.');

  const anime = await loadAnidle([Number(puzzle.answer_id), malId]);
  const feedback = compareAnidle(anime.get(Number(puzzle.answer_id))!, anime.get(malId)!);
  const guesses = [...before.guesses.map((g) => g.malId), malId];
  const finished = feedback.correct || guesses.length >= ANIDLE_MAX_GUESSES;
  const score = finished ? anidleScore(feedback.correct, guesses.length) : null;
  await run(
    `INSERT INTO play (puzzle_id, username, guesses, solved, score, finished_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (puzzle_id, username) DO UPDATE SET guesses = excluded.guesses, solved = excluded.solved, score = excluded.score, finished_at = excluded.finished_at`,
    [puzzle.id, username, JSON.stringify(guesses), feedback.correct ? 1 : 0, score, finished ? nowIso() : null],
  );
  return puzzleState(puzzle, username);
}
