import { randomUUID } from 'node:crypto';
import { anidleScore, compareAnidle, type AnidleAnime, type AnidleFeedback } from '../shared/anidle.js';
import {
  ANIDLE_MAX_GUESSES,
  DAILY_DIFFICULTIES,
  DIFFICULTIES,
  difficultyOf,
  EASY_MIN_MEMBERS,
  MEDIUM_MIN_MEMBERS,
  POOL_NEEDS_MAL,
  POOLS,
  type Difficulty,
  type GenreType,
  type Pool,
} from '../shared/catalog.js';
import { isRoundMode, MODES, ROUND_COUNT, ROUND_MODES, todayWib, type MediaKind, type Mode } from '../shared/modes.js';
import type { TitleEntry } from '../shared/normalize.js';
import type { Account } from './accounts.js';
import { seedOf } from './crypto.js';
import { all, db, nowIso, one, run } from './db.js';
import { poolUsers } from './env.js';
import { HttpError } from './http.js';
import { COVER_KEY_SQL, coverOf } from './media.js';

export function parseMode(value: unknown): Mode {
  if (typeof value === 'string' && (MODES as readonly string[]).includes(value)) return value as Mode;
  throw new HttpError(400, `Mode tidak dikenal: ${String(value)}`);
}

export interface PoolSpec {
  pool: Pool;
  /** MAL usernames of the shared pool (POOL_USERS). */
  members: string[];
  /** The player's linked MAL username, for `saya`. */
  malUsername: string | null;
  /** Any MAL genre id (genre, theme, demographic); applies to every pool. */
  genreId?: number;
  /** Empty = every difficulty. */
  difficulties: readonly Difficulty[];
  /** Only titles whose media of this kind is in R2 (round modes). */
  media?: MediaKind;
}

/** Difficulty condition on alias `a` (thresholds from shared/catalog.ts). */
export const DIFFICULTY_SQL: Record<Difficulty, string> = {
  easy: `a.members >= ${EASY_MIN_MEMBERS}`,
  medium: `a.members >= ${MEDIUM_MIN_MEMBERS} AND a.members < ${EASY_MIN_MEMBERS}`,
  hard: `(a.members < ${MEDIUM_MIN_MEMBERS} OR a.members IS NULL)`,
};

/** Which titles a pool contains, before filters. */
function poolSource({ pool, members, malUsername }: PoolSpec): { sql: string; args: Array<string | number> } {
  const marks = members.map(() => '?').join(',');
  const byFriend = members.length ? `EXISTS (SELECT 1 FROM completed c WHERE c.mal_id = a.mal_id AND c.username IN (${marks}))` : '0';
  const popular = 'EXISTS (SELECT 1 FROM popular p WHERE p.mal_id = a.mal_id)';
  switch (pool) {
    case 'semua':
      return { sql: `(${byFriend} OR ${popular})`, args: members };
    case 'teman':
      return { sql: byFriend, args: members };
    case 'bareng':
      // Completed by every member that has a list at all.
      if (!members.length) return { sql: '0', args: [] };
      return {
        sql: `${byFriend} AND (SELECT COUNT(DISTINCT c.username) FROM completed c WHERE c.mal_id = a.mal_id AND c.username IN (${marks}))
              = (SELECT COUNT(DISTINCT username) FROM completed WHERE username IN (${marks}))`,
        args: [...members, ...members, ...members],
      };
    case 'saya':
      if (!malUsername) return { sql: '0', args: [] };
      return { sql: 'EXISTS (SELECT 1 FROM completed c WHERE c.mal_id = a.mal_id AND c.username = ?)', args: [malUsername] };
    case 'populer':
      return { sql: popular, args: [] };
  }
}

/** SQL condition (on alias `a`) selecting the titles of a pool with its filters. Excluded titles never qualify. */
function poolWhere(spec: PoolSpec): { sql: string; args: Array<string | number> } {
  const source = poolSource(spec);
  const parts = ['a.excluded IS NULL', source.sql];
  const args = [...source.args];
  if (spec.genreId) {
    parts.push('EXISTS (SELECT 1 FROM anime_genre g WHERE g.mal_id = a.mal_id AND g.genre_id = ?)');
    args.push(spec.genreId);
  }
  if (spec.difficulties.length) parts.push(`(${spec.difficulties.map((d) => `(${DIFFICULTY_SQL[d]})`).join(' OR ')})`);
  if (spec.media) {
    parts.push(`EXISTS (SELECT 1 FROM anime_media m WHERE m.mal_id = a.mal_id AND m.kind = ? AND m.status = 'ok')`);
    args.push(spec.media);
  }
  return { sql: parts.join(' AND '), args };
}

export function parsePool(value: unknown): Pool {
  if (typeof value === 'string' && (POOLS as readonly string[]).includes(value)) return value as Pool;
  throw new HttpError(400, `Pool tidak dikenal: ${String(value)}`);
}

export function parseDifficulties(value: unknown): Difficulty[] {
  if (value == null || value === '') return [];
  const list = Array.isArray(value) ? value : [value];
  for (const d of list) if (!(DIFFICULTIES as readonly unknown[]).includes(d)) throw new HttpError(400, `Difficulty tidak dikenal: ${String(d)}`);
  return list as Difficulty[];
}

/** Unlimited filters, stored with the puzzle so a round can be replaced from the same pool. */
export interface PuzzleOptions {
  genreId?: number;
  difficulties?: readonly Difficulty[];
}

/** Pool spec for a player and mode; completed-list pools need a linked MAL account. */
export function poolSpec(pool: Pool, account: Account | null, mode: Mode, filters: PuzzleOptions = {}): PoolSpec {
  if (POOL_NEEDS_MAL[pool] && !account?.malUsername) throw new HttpError(403, 'Pool ini butuh akun MAL yang terhubung. Masuk lalu hubungkan akun MAL dulu.');
  return {
    pool,
    members: poolUsers(),
    malUsername: account?.malUsername ?? null,
    genreId: filters.genreId,
    difficulties: filters.difficulties ?? [],
    media: isRoundMode(mode) ? ROUND_MODES[mode].media : undefined,
  };
}

export interface PoolTitle {
  malId: number;
  /** Titles of one franchise share this key, so a puzzle never asks the same show twice. */
  franchise: number;
}

export async function poolTitles(spec: PoolSpec): Promise<PoolTitle[]> {
  const where = poolWhere(spec);
  const rows = await all<{ mal_id: number; franchise_id: number | null }>(`SELECT a.mal_id, a.franchise_id FROM anime a WHERE ${where.sql} ORDER BY a.mal_id`, where.args);
  return rows.map((r) => ({ malId: Number(r.mal_id), franchise: r.franchise_id == null ? -Number(r.mal_id) : Number(r.franchise_id) }));
}

/**
 * Autocomplete list: every usable title in the database, so any pool's answer can be typed and the
 * list itself does not hint at which pool (or answer) is in play.
 */
export async function titleEntries(): Promise<TitleEntry[]> {
  const rows = await all<{ mal_id: number; title: string; title_en: string | null; title_ja: string | null; synonyms: string; year: number | null; media_type: string | null }>(
    'SELECT mal_id, title, title_en, title_ja, synonyms, year, media_type FROM anime WHERE excluded IS NULL ORDER BY members DESC',
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
  cover_key: string | null;
  members: number | null;
}

export type LoadedAnime = AnidleAnime & { cover: string | null; members: number | null };

export async function loadAnidle(ids: number[]): Promise<Map<number, LoadedAnime>> {
  if (!ids.length) return new Map();
  const marks = ids.map(() => '?').join(',');
  const rows = await all<AnimeRow>(
    `SELECT a.mal_id, a.title, a.media_type, a.year, a.season, a.num_episodes, a.score, a.source, a.studios, a.franchise_id, a.cover_src,
            ${COVER_KEY_SQL} AS cover_key, a.members
     FROM anime a WHERE a.mal_id IN (${marks})`,
    ids,
  );
  const genreRows = await all<{ mal_id: number; name: string; type: GenreType }>(
    `SELECT ag.mal_id, g.name, g.type FROM anime_genre ag JOIN genre g ON g.id = ag.genre_id WHERE ag.mal_id IN (${marks}) ORDER BY g.name`,
    ids,
  );
  const out = new Map<number, LoadedAnime>();
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
      cover: coverOf(r.cover_key, r.cover_src),
      members: r.members == null ? null : Number(r.members),
    });
  }
  for (const g of genreRows) {
    const anime = out.get(Number(g.mal_id));
    // Explicit genres (Ecchi) count as genres for the clue table.
    if (anime) (g.type === 'themes' ? anime.themes : g.type === 'demographics' ? anime.demographics : anime.genres).push(g.name);
  }
  return out;
}

/** What a finished puzzle (or round) reveals about its answer. */
export interface AnswerInfo {
  malId: number;
  title: string;
  cover: string | null;
  year: number | null;
  members: number | null;
  difficulty: Difficulty;
}

export const answerInfo = (a: LoadedAnime): AnswerInfo => ({
  malId: a.malId,
  title: a.title,
  cover: a.cover,
  year: a.year,
  members: a.members,
  difficulty: difficultyOf(a.members),
});

// ------------------------------------------------------------------ puzzles

const RECENT_DAYS_WITHOUT_REPEAT = 60;

/** Answers per puzzle: Anidle has one, round modes one per round. */
const ANSWERS: Record<Mode, number> = { anidle: 1, opening: ROUND_COUNT, ending: ROUND_COUNT, character: ROUND_COUNT, screenshot: ROUND_COUNT };

export interface PuzzleRow {
  id: string;
  date: string | null;
  mode: Mode;
  pool: Pool;
  /** The answer of Anidle, round 0 of round modes (all rounds are in puzzle_round). */
  answer_id: number;
  created_by: string | null;
  /** JSON PuzzleOptions of an unlimited puzzle. */
  options: string | null;
}

/**
 * `count` titles from distinct franchises. `draw(n, size)` gives the n-th random index; daily puzzles
 * pass a date-seeded one so every server picks the same answers.
 */
export function pickTitles(from: PoolTitle[], count: number, draw: (n: number, size: number) => number, avoidFranchises: Iterable<number> = []): number[] {
  const used = new Set(avoidFranchises);
  const picked: number[] = [];
  for (let n = 0; picked.length < count && n < count * 50; n++) {
    const title = from[draw(n, from.length)]!;
    if (used.has(title.franchise)) continue;
    used.add(title.franchise);
    picked.push(title.malId);
  }
  if (picked.length < count) throw new HttpError(404, 'Pool ini terlalu kecil untuk mode ini.');
  return picked;
}

export const randomDraw = (_n: number, size: number) => Math.floor(Math.random() * size);

const roundInserts = (puzzleId: string, answers: number[]) =>
  answers.map((malId, round) => ({ sql: 'INSERT OR IGNORE INTO puzzle_round (puzzle_id, round, mal_id) VALUES (?, ?, ?)', args: [puzzleId, round, malId] }));

export async function dailyPuzzle(mode: Mode): Promise<PuzzleRow> {
  const date = todayWib();
  const existing = await one<PuzzleRow>('SELECT * FROM puzzle WHERE date = ? AND mode = ?', [date, mode]);
  if (existing) return existing;

  const titles = await poolTitles(poolSpec('semua', null, mode, { difficulties: DAILY_DIFFICULTIES }));
  if (!titles.length) throw new HttpError(503, 'Pool masih kosong. Jalankan pipeline dulu.');
  const since = todayWib(Date.now() - RECENT_DAYS_WITHOUT_REPEAT * 86_400_000);
  const recent = new Set(
    (
      await all<{ mal_id: number }>(
        `SELECT answer_id AS mal_id FROM puzzle WHERE mode = ? AND date >= ?
         UNION SELECT r.mal_id FROM puzzle_round r JOIN puzzle p ON p.id = r.puzzle_id WHERE p.mode = ? AND p.date >= ?`,
        [mode, since, mode, since],
      )
    ).map((r) => Number(r.mal_id)),
  );
  const fresh = titles.filter((t) => !recent.has(t.malId));
  const count = ANSWERS[mode];
  // Draw 0 keeps the seed Anidle has always used, so its daily answers did not change with round modes.
  const seeded = (n: number, size: number) => Number(seedOf(n ? `${date}:${mode}:${n}` : `${date}:${mode}`) % BigInt(size));
  const answers = pickTitles(fresh.length >= count * 5 ? fresh : titles, count, seeded);

  // Concurrent first requests race here; UNIQUE(date, mode) keeps exactly one puzzle, and both
  // requests computed the same answers, so the rounds go to whichever puzzle row won.
  await run('INSERT OR IGNORE INTO puzzle (id, date, mode, pool, answer_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), date, mode, 'semua', answers[0]!, nowIso()]);
  const row = (await one<PuzzleRow>('SELECT * FROM puzzle WHERE date = ? AND mode = ?', [date, mode]))!;
  if (isRoundMode(mode)) await db().batch(roundInserts(row.id, answers), 'write');
  return row;
}

export async function unlimitedPuzzle(mode: Mode, spec: PoolSpec, options: PuzzleOptions, playerKey: string): Promise<PuzzleRow> {
  const titles = await poolTitles(spec);
  if (!titles.length) throw new HttpError(404, 'Pool ini kosong.');
  const answers = pickTitles(titles, ANSWERS[mode], randomDraw);
  const row: PuzzleRow = { id: randomUUID(), date: null, mode, pool: spec.pool, answer_id: answers[0]!, created_by: playerKey, options: JSON.stringify(options) };
  await db().batch(
    [
      {
        sql: 'INSERT INTO puzzle (id, date, mode, pool, answer_id, created_by, options, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [row.id, row.date, row.mode, row.pool, row.answer_id, row.created_by, row.options, nowIso()],
      },
      ...(isRoundMode(mode) ? roundInserts(row.id, answers) : []),
    ],
    'write',
  );
  return row;
}

export async function getPuzzle(id: string): Promise<PuzzleRow> {
  const row = await one<PuzzleRow>('SELECT * FROM puzzle WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Puzzle tidak ditemukan.');
  return row;
}

export interface PlayRow {
  guesses: string;
  solved: number;
  score: number | null;
}

/** `playerKey` is play.username: 'u:<account id>' or 'a:<anonymous id>'. */
export const readPlay = (puzzleId: string, playerKey: string) =>
  one<PlayRow>('SELECT guesses, solved, score FROM play WHERE puzzle_id = ? AND username = ?', [puzzleId, playerKey]);

export async function writePlay(puzzleId: string, playerKey: string, play: { guesses: unknown; solved: number; score: number | null; finished: boolean }) {
  await run(
    `INSERT INTO play (puzzle_id, username, guesses, solved, score, finished_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT (puzzle_id, username) DO UPDATE SET guesses = excluded.guesses, solved = excluded.solved, score = excluded.score, finished_at = excluded.finished_at`,
    [puzzleId, playerKey, JSON.stringify(play.guesses), play.solved, play.score, play.finished ? nowIso() : null],
  );
}

export async function assertPlayable(malId: number) {
  const known = await one<{ mal_id: number }>('SELECT mal_id FROM anime WHERE mal_id = ? AND excluded IS NULL', [malId]);
  if (!known) throw new HttpError(400, 'Judul itu tidak ada di pool.');
}

// ------------------------------------------------------------------ Anidle

export interface AnidleState {
  id: string;
  mode: 'anidle';
  date: string | null;
  pool: Pool;
  maxGuesses: number;
  guesses: AnidleFeedback[];
  solved: boolean;
  finished: boolean;
  score: number | null;
  /** Only once finished: the answer is never sent before that. */
  answer: AnswerInfo | null;
}

export async function anidleState(puzzle: PuzzleRow, playerKey: string): Promise<AnidleState> {
  const play = await readPlay(puzzle.id, playerKey);
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
    mode: 'anidle',
    date: puzzle.date,
    pool: puzzle.pool,
    maxGuesses: ANIDLE_MAX_GUESSES,
    guesses,
    solved,
    finished,
    score: play?.score ?? null,
    answer: finished ? answerInfo(answer) : null,
  };
}

export async function anidleGuess(puzzle: PuzzleRow, playerKey: string, malId: number): Promise<AnidleState> {
  const before = await anidleState(puzzle, playerKey);
  if (before.finished) throw new HttpError(409, 'Puzzle ini sudah selesai.');
  if (before.guesses.some((g) => g.malId === malId)) throw new HttpError(409, 'Judul itu sudah kamu tebak.');
  await assertPlayable(malId);

  const anime = await loadAnidle([Number(puzzle.answer_id), malId]);
  const feedback = compareAnidle(anime.get(Number(puzzle.answer_id))!, anime.get(malId)!);
  const guesses = [...before.guesses.map((g) => g.malId), malId];
  const finished = feedback.correct || guesses.length >= ANIDLE_MAX_GUESSES;
  await writePlay(puzzle.id, playerKey, { guesses, solved: feedback.correct ? 1 : 0, score: finished ? anidleScore(feedback.correct, guesses.length) : null, finished });
  return anidleState(puzzle, playerKey);
}
