import { randomUUID } from 'node:crypto';
import { ANIDLE_CLUES, anidleScore, compareAnidle, maskSynopsis, type AnidleAnime, type AnidleClueKind, type AnidleFeedback } from '../shared/anidle.js';
import {
  ANIDLE_MAX_GUESSES,
  CANONICAL_SQL,
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
import { CHARACTER_MIN_FAVORITES, CHARACTER_ROUND_DIFFICULTIES, characterDifficultyOf, displayName } from '../shared/characters.js';
import { CHARACTERS_PER_ROUND, FIRST_DAILY_DATE, isRoundMode, isSongMode, MODE_MEDIA, MODES, ROUND_COUNT, roundDifficulties, shiftDate, todayWib, type MediaKind, type Mode } from '../shared/modes.js';
import type { TitleEntry } from '../shared/normalize.js';
import type { Account } from './accounts.js';
import { seedOf } from './crypto.js';
import { all, db, nowIso, one, run } from './db.js';
import { poolUsers } from './env.js';
import { HttpError } from './http.js';
import { COVER_KEY_SQL, coverOf, mediaUrl } from './media.js';

export function parseMode(value: unknown): Mode {
  if (typeof value === 'string' && (MODES as readonly string[]).includes(value)) return value as Mode;
  throw new HttpError(400, `Unknown mode: ${String(value)}`);
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
  /** Only titles whose media of this kind is in R2 (every mode but Anidle). */
  media?: MediaKind;
  /** Only these MAL media types (Character mode: TV, so movies and specials don't repeat a show's cast). */
  mediaTypes?: readonly string[];
}

/** Difficulty condition on alias `a` (thresholds from shared/catalog.ts). */
export const DIFFICULTY_SQL: Record<Difficulty, string> = {
  easy: `a.members >= ${EASY_MIN_MEMBERS}`,
  medium: `a.members >= ${MEDIUM_MIN_MEMBERS} AND a.members < ${EASY_MIN_MEMBERS}`,
  hard: `(a.members < ${MEDIUM_MIN_MEMBERS} OR a.members IS NULL)`,
};

/**
 * SQL (on aliases `a` = the canonical entry and `col` = some table's mal_id) for "col is an entry of
 * a's show": a itself or any entry the franchise step pointed at it. A friend who completed season 2
 * has completed the show.
 */
const ofShow = (col: string) => `(${col} = a.mal_id OR ${col} IN (SELECT x.mal_id FROM anime x WHERE x.canonical_id = a.mal_id))`;

/** Which shows a pool contains, before filters. */
function poolSource({ pool, members, malUsername }: PoolSpec): { sql: string; args: Array<string | number> } {
  const marks = members.map(() => '?').join(',');
  const byFriend = members.length ? `EXISTS (SELECT 1 FROM completed c WHERE c.username IN (${marks}) AND ${ofShow('c.mal_id')})` : '0';
  const popular = `EXISTS (SELECT 1 FROM popular p WHERE ${ofShow('p.mal_id')})`;
  switch (pool) {
    case 'semua':
      return { sql: `(${byFriend} OR ${popular})`, args: members };
    case 'teman':
      return { sql: byFriend, args: members };
    case 'bareng':
      // Completed (any entry of the show) by every member that has a list at all.
      if (!members.length) return { sql: '0', args: [] };
      return {
        sql: `${byFriend} AND (SELECT COUNT(DISTINCT c.username) FROM completed c WHERE c.username IN (${marks}) AND ${ofShow('c.mal_id')})
              = (SELECT COUNT(DISTINCT username) FROM completed WHERE username IN (${marks}))`,
        args: [...members, ...members, ...members],
      };
    case 'saya':
      if (!malUsername) return { sql: '0', args: [] };
      return { sql: `EXISTS (SELECT 1 FROM completed c WHERE c.username = ? AND ${ofShow('c.mal_id')})`, args: [malUsername] };
    case 'populer':
      return { sql: popular, args: [] };
  }
}

/** SQL condition (on alias `a`) selecting the shows of a pool with its filters. Excluded titles never qualify. */
function poolWhere(spec: PoolSpec): { sql: string; args: Array<string | number> } {
  const source = poolSource(spec);
  const parts = ['a.excluded IS NULL', CANONICAL_SQL, source.sql];
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
  if (spec.mediaTypes?.length) {
    parts.push(`a.media_type IN (${spec.mediaTypes.map(() => '?').join(',')})`);
    args.push(...spec.mediaTypes);
  }
  return { sql: parts.join(' AND '), args };
}

export function parsePool(value: unknown): Pool {
  if (typeof value === 'string' && (POOLS as readonly string[]).includes(value)) return value as Pool;
  throw new HttpError(400, `Unknown pool: ${String(value)}`);
}

export function parseDifficulties(value: unknown): Difficulty[] {
  if (value == null || value === '') return [];
  const list = Array.isArray(value) ? value : [value];
  for (const d of list) if (!(DIFFICULTIES as readonly unknown[]).includes(d)) throw new HttpError(400, `Unknown difficulty: ${String(d)}`);
  return list as Difficulty[];
}

/** Unlimited filters, stored with the puzzle so a round can be replaced from the same pool. */
export interface PuzzleOptions {
  genreId?: number;
  difficulties?: readonly Difficulty[];
}

/** Pool spec for a player and mode; completed-list pools need a linked MAL account. */
export function poolSpec(pool: Pool, account: Account | null, mode: Mode, filters: PuzzleOptions = {}): PoolSpec {
  if (POOL_NEEDS_MAL[pool] && !account?.malUsername) throw new HttpError(403, 'This pool needs a linked MAL account. Sign in and link your MAL account first.');
  return {
    pool,
    members: poolUsers(),
    malUsername: account?.malUsername ?? null,
    genreId: filters.genreId,
    difficulties: filters.difficulties ?? [],
    media: MODE_MEDIA[mode] ?? undefined,
    mediaTypes: mode === 'character' ? ['tv'] : undefined,
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
 * Autocomplete list: every show in the database (one entry per franchise, named after its canonical
 * entry but also found by its other seasons' names), so any pool's answer can be typed and the list
 * itself does not hint at which pool (or answer) is in play.
 */
export async function titleEntries(): Promise<TitleEntry[]> {
  const rows = await all<{ mal_id: number; show: number; title: string; title_en: string | null; title_ja: string | null; synonyms: string; year: number | null; media_type: string | null }>(
    `SELECT mal_id, COALESCE(canonical_id, mal_id) AS show, title, title_en, title_ja, synonyms, year, media_type
     FROM anime WHERE excluded IS NULL ORDER BY (COALESCE(canonical_id, mal_id) = mal_id) DESC, members DESC`,
  );
  // Canonical rows come first, so every show exists before its other entries add their names.
  const shows = new Map<number, { entry: Omit<TitleEntry, 'names'>; names: Set<string> }>();
  for (const r of rows) {
    const names = [r.title, r.title_en, r.title_ja, ...(JSON.parse(r.synonyms) as string[])].filter((n): n is string => Boolean(n));
    const show = shows.get(Number(r.show));
    if (show) for (const n of names) show.names.add(n);
    else if (Number(r.show) === Number(r.mal_id)) shows.set(Number(r.mal_id), { entry: { id: Number(r.mal_id), year: r.year == null ? null : Number(r.year), type: r.media_type }, names: new Set(names) });
  }
  return [...shows.values()].map(({ entry, names }) => ({ ...entry, names: [...names] }));
}

interface AnimeRow {
  mal_id: number;
  title: string;
  year: number | null;
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
    `SELECT a.mal_id, a.title, a.year, a.score, a.source, a.studios, a.franchise_id, a.cover_src,
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
      year: r.year == null ? null : Number(r.year),
      score: r.score == null ? null : Number(r.score),
      source: r.source,
      studios: JSON.parse(r.studios) as string[],
      genres: [],
      tags: [],
      franchiseId: r.franchise_id == null ? null : Number(r.franchise_id),
      cover: coverOf(r.cover_key, r.cover_src),
      members: r.members == null ? null : Number(r.members),
    });
  }
  for (const g of genreRows) {
    const anime = out.get(Number(g.mal_id));
    // Explicit genres (Ecchi) count as genres; themes and demographics are tags.
    if (anime) (g.type === 'themes' || g.type === 'demographics' ? anime.tags : anime.genres).push(g.name);
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

/** Rounds × answers per round: Anidle one answer, round modes one title per round, Character four. */
const SHAPE: Record<Mode, { rounds: number; perRound: number }> = {
  anidle: { rounds: 1, perRound: 1 },
  opening: { rounds: ROUND_COUNT, perRound: 1 },
  ending: { rounds: ROUND_COUNT, perRound: 1 },
  screenshot: { rounds: ROUND_COUNT, perRound: 1 },
  character: { rounds: ROUND_COUNT, perRound: CHARACTERS_PER_ROUND },
};

export interface PuzzleRow {
  id: string;
  date: string | null;
  mode: Mode;
  pool: Pool;
  /** The answer of Anidle; the first title of other modes (all of them are in puzzle_round / puzzle_character). */
  answer_id: number;
  created_by: string | null;
  /** JSON PuzzleOptions of an unlimited puzzle. */
  options: string | null;
}

/** The n-th random index into a list of `size` for `round`; daily puzzles seed it by date. */
export type Draw = (round: number, n: number, size: number) => number;

export const randomDraw: Draw = (_round, _n, size) => Math.floor(Math.random() * size);

/** `count` titles from franchises not in `used` (nor repeated among themselves), or null if the list runs out. */
export function pickTitles(from: PoolTitle[], count: number, draw: (n: number, size: number) => number, used: ReadonlySet<number> = new Set()): PoolTitle[] | null {
  if (from.length < count) return null;
  const taken = new Set(used);
  const picked: PoolTitle[] = [];
  for (let n = 0; picked.length < count && n < count * 50; n++) {
    const title = from[draw(n, from.length)]!;
    if (taken.has(title.franchise)) continue;
    taken.add(title.franchise);
    picked.push(title);
  }
  return picked.length === count ? picked : null;
}

/** For Character mode: the character difficulties each show can be asked at (from its stored characters' favorites). */
async function characterDifficultiesByShow(): Promise<Map<number, Set<Difficulty>>> {
  const rows = await all<{ mal_id: number; favorites: number }>('SELECT mal_id, favorites FROM anime_character WHERE favorites >= ?', [CHARACTER_MIN_FAVORITES]);
  const out = new Map<number, Set<Difficulty>>();
  for (const r of rows) {
    const set = out.get(Number(r.mal_id)) ?? new Set<Difficulty>();
    set.add(characterDifficultyOf(Number(r.favorites)));
    out.set(Number(r.mal_id), set);
  }
  return out;
}

/**
 * The answers of a new puzzle per round, all from different franchises. Each round draws from its
 * roundDifficulties() slice of the pool (round 1 easy, then medium); a slice that is too small (media
 * still being copied) falls back to the whole pool. Character mode instead keeps the whole pool for
 * every round and asks for a character of CHARACTER_ROUND_DIFFICULTIES[round] (easy, medium, hard by
 * the character's own popularity), so only shows with such a character qualify. Titles in `avoid`
 * (recent daily answers) are only reused when nothing else is left.
 */
export async function drawRounds(mode: Mode, spec: PoolSpec, draw: Draw, avoid: ReadonlySet<number> = new Set()): Promise<number[][]> {
  const { rounds, perRound } = SHAPE[mode];
  const pools = new Map<string, Promise<PoolTitle[]>>();
  const titlesOf = (difficulties: readonly Difficulty[]) => {
    const key = [...difficulties].sort().join();
    if (!pools.has(key)) pools.set(key, poolTitles({ ...spec, difficulties }));
    return pools.get(key)!;
  };
  const characters = mode === 'character' ? await characterDifficultiesByShow() : null;
  const used = new Set<number>();
  const out: number[][] = [];
  for (let round = 0; round < rounds; round++) {
    const staged = rounds > 1 && !characters ? roundDifficulties(spec.difficulties, round) : spec.difficulties;
    const tries = staged === spec.difficulties ? [staged] : [staged, spec.difficulties];
    const wanted = CHARACTER_ROUND_DIFFICULTIES[round]!;
    const roundDraw = (n: number, size: number) => draw(round, n, size);
    let picked: PoolTitle[] | null = null;
    for (const difficulties of tries) {
      const titles = await titlesOf(difficulties);
      const pool = characters ? titles.filter((t) => characters.get(t.malId)?.has(wanted)) : titles;
      picked = pickTitles(pool.filter((t) => !avoid.has(t.malId)), perRound, roundDraw, used) ?? pickTitles(pool, perRound, roundDraw, used);
      if (picked) break;
    }
    if (!picked) throw new HttpError(404, 'This pool is too small for this mode.');
    for (const t of picked) used.add(t.franchise);
    out.push(picked.map((t) => t.malId));
  }
  return out;
}

/**
 * Rows that store a new puzzle's answers: puzzle_round for one-title rounds (song, staged), puzzle_character
 * for Character, whose character per show is drawn among its characters of the round's difficulty.
 */
async function answerInserts(puzzleId: string, mode: Mode, answers: number[][], draw: Draw) {
  if (isRoundMode(mode) || isSongMode(mode))
    return answers.map(([malId], round) => ({ sql: 'INSERT OR IGNORE INTO puzzle_round (puzzle_id, round, mal_id) VALUES (?, ?, ?)', args: [puzzleId, round, malId!] }));
  if (mode !== 'character') return [];
  const ids = answers.flat();
  const chars = await all<{ mal_id: number; char_id: number; favorites: number }>(
    `SELECT mal_id, char_id, favorites FROM anime_character WHERE favorites >= ? AND mal_id IN (${ids.map(() => '?').join(',')}) ORDER BY favorites DESC`,
    [CHARACTER_MIN_FAVORITES, ...ids],
  );
  const byShow = Map.groupBy(chars, (c) => Number(c.mal_id));
  return answers.flatMap((titles, round) =>
    titles.map((malId, slot) => {
      const known = byShow.get(malId) ?? [];
      const fitting = known.filter((c) => characterDifficultyOf(Number(c.favorites)) === CHARACTER_ROUND_DIFFICULTIES[round]);
      const from = fitting.length ? fitting : known;
      // Draw indexes past the title draws (n < 200), so the character choice is its own random number.
      const charId = from.length ? Number(from[draw(round, 1000 + slot, from.length)]!.char_id) : 0;
      return { sql: 'INSERT OR IGNORE INTO puzzle_character (puzzle_id, round, slot, mal_id, char_id) VALUES (?, ?, ?, ?, ?)', args: [puzzleId, round, slot, malId, charId] };
    }),
  );
}

/** A daily puzzle's date from a request: today when absent, else a day between FIRST_DAILY_DATE and today. */
export function parseDailyDate(value: string | null): string {
  const today = todayWib();
  if (!value) return today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today || value < FIRST_DAILY_DATE) throw new HttpError(400, `Daily puzzles exist from ${FIRST_DAILY_DATE} to today.`);
  return value;
}

/** The daily puzzle of `mode` on `date` (today or an earlier day of the archive), created on first request. */
export async function dailyPuzzle(mode: Mode, date: string): Promise<PuzzleRow> {
  const existing = await one<PuzzleRow>('SELECT * FROM puzzle WHERE date = ? AND mode = ?', [date, mode]);
  if (existing) return existing;

  // No answer repeats within RECENT_DAYS_WITHOUT_REPEAT on either side (an archive day may be created after later ones).
  const since = shiftDate(date, -RECENT_DAYS_WITHOUT_REPEAT);
  const until = shiftDate(date, RECENT_DAYS_WITHOUT_REPEAT);
  const recent = new Set(
    (
      await all<{ mal_id: number }>(
        `SELECT answer_id AS mal_id FROM puzzle WHERE mode = ? AND date BETWEEN ? AND ?
         UNION SELECT r.mal_id FROM puzzle_round r JOIN puzzle p ON p.id = r.puzzle_id WHERE p.mode = ? AND p.date BETWEEN ? AND ?
         UNION SELECT c.mal_id FROM puzzle_character c JOIN puzzle p ON p.id = c.puzzle_id WHERE p.mode = ? AND p.date BETWEEN ? AND ?`,
        [mode, since, until, mode, since, until, mode, since, until],
      )
    ).map((r) => Number(r.mal_id)),
  );
  // Anidle keeps the seed it has always used (`date:mode`, then `date:mode:n`), so its answers did not change.
  // A rerolled date (npm run daily:reroll) seeds with `date#n` instead, so the draw comes out different.
  const reroll = await one<{ n: number }>('SELECT n FROM daily_reroll WHERE date = ?', [date]);
  const day = reroll ? `${date}#${reroll.n}` : date;
  const seeded: Draw = (round, n, size) =>
    Number(seedOf(mode === 'anidle' ? (n ? `${day}:${mode}:${n}` : `${day}:${mode}`) : `${day}:${mode}:${round}:${n}`) % BigInt(size));
  const answers = await drawRounds(mode, poolSpec('semua', null, mode, { difficulties: DAILY_DIFFICULTIES }), seeded, recent);

  // Concurrent first requests race here; UNIQUE(date, mode) keeps exactly one puzzle, and both
  // requests drew the same answers, so the answer rows go to whichever puzzle row won.
  await run('INSERT OR IGNORE INTO puzzle (id, date, mode, pool, answer_id, created_at) VALUES (?, ?, ?, ?, ?, ?)', [randomUUID(), date, mode, 'semua', answers[0]![0]!, nowIso()]);
  const row = (await one<PuzzleRow>('SELECT * FROM puzzle WHERE date = ? AND mode = ?', [date, mode]))!;
  const inserts = await answerInserts(row.id, mode, answers, seeded);
  if (inserts.length) await db().batch(inserts, 'write');
  return row;
}

export async function unlimitedPuzzle(mode: Mode, spec: PoolSpec, options: PuzzleOptions, playerKey: string): Promise<PuzzleRow> {
  const answers = await drawRounds(mode, spec, randomDraw);
  const row: PuzzleRow = { id: randomUUID(), date: null, mode, pool: spec.pool, answer_id: answers[0]![0]!, created_by: playerKey, options: JSON.stringify(options) };
  await db().batch(
    [
      {
        sql: 'INSERT INTO puzzle (id, date, mode, pool, answer_id, created_by, options, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [row.id, row.date, row.mode, row.pool, row.answer_id, row.created_by, row.options, nowIso()],
      },
      ...(await answerInserts(row.id, mode, answers, randomDraw)),
    ],
    'write',
  );
  return row;
}

/**
 * Puts another title from the same pool and round difficulty into `round` of an unlimited puzzle that
 * stores one title per round (song and staged modes). The caller checks the round is untouched.
 */
export async function swapRoundTitle(puzzle: PuzzleRow, account: Account | null, round: number): Promise<void> {
  if (!Number.isInteger(round) || round < 0 || round >= ROUND_COUNT) throw new HttpError(400, 'Unknown round.');
  const options: PuzzleOptions = puzzle.options ? (JSON.parse(puzzle.options) as PuzzleOptions) : {};
  const current = await all<{ mal_id: number }>('SELECT mal_id FROM puzzle_round WHERE puzzle_id = ?', [puzzle.id]);
  const taken = new Set(current.map((r) => Number(r.mal_id)));
  const franchises = new Set([...(await loadAnidle([...taken])).values()].map((a) => a.franchiseId ?? -a.malId));
  const spec = poolSpec(puzzle.pool, account, puzzle.mode, options);
  const titles = (await poolTitles({ ...spec, difficulties: roundDifficulties(spec.difficulties, round) })).filter((t) => !taken.has(t.malId));
  const replacement = pickTitles(titles, 1, (_n, size) => Math.floor(Math.random() * size), franchises)?.[0];
  if (!replacement) throw new HttpError(404, 'No other title left in this pool.');
  await db().batch(
    [
      { sql: 'UPDATE puzzle_round SET mal_id = ? WHERE puzzle_id = ? AND round = ?', args: [replacement.malId, puzzle.id, round] },
      ...(round === 0 ? [{ sql: 'UPDATE puzzle SET answer_id = ? WHERE id = ?', args: [replacement.malId, puzzle.id] }] : []),
    ],
    'write',
  );
}

export async function getPuzzle(id: string): Promise<PuzzleRow> {
  const row = await one<PuzzleRow>('SELECT * FROM puzzle WHERE id = ?', [id]);
  if (!row) throw new HttpError(404, 'Puzzle not found.');
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
  if (!known) throw new HttpError(400, 'That title is not in the pool.');
}

// ------------------------------------------------------------------ Anidle

/** Keyed by AnidleClueKind, so a clue is present exactly when it is unlocked. */
export interface AnidleClues {
  /** The anime's poster (blurred in the UI). */
  cover: string | null;
  /** MAL synopsis with the title masked (null when MAL has none). */
  synopsis: string | null;
  /** The two best-known characters. */
  characters: Array<{ name: string; portrait: string }> | null;
}

export interface AnidleState {
  id: string;
  mode: 'anidle';
  date: string | null;
  pool: Pool;
  maxGuesses: number;
  /** Every try in order; null = a try used by Skip. */
  guesses: Array<AnidleFeedback | null>;
  solved: boolean;
  finished: boolean;
  score: number | null;
  /** Clues unlocked so far (ANIDLE_CLUES); a locked one is absent, so nothing leaks early. */
  clues: Partial<AnidleClues>;
  /** Only once finished: the answer is never sent before that. */
  answer: AnswerInfo | null;
}

/** The clues of `kinds` for one show; only those are read. */
async function anidleClues(malId: number, kinds: ReadonlySet<AnidleClueKind>, cover: string | null): Promise<Partial<AnidleClues>> {
  const clues: Partial<AnidleClues> = {};
  if (kinds.has('cover')) clues.cover = cover;
  if (kinds.has('synopsis')) {
    const row = await one<{ synopsis: string | null; title: string; title_en: string | null; title_ja: string | null; synonyms: string }>(
      'SELECT synopsis, title, title_en, title_ja, synonyms FROM anime WHERE mal_id = ?',
      [malId],
    );
    const names = row ? [row.title, row.title_en, row.title_ja, ...(JSON.parse(row.synonyms) as string[])].filter((n): n is string => Boolean(n)) : [];
    clues.synopsis = row?.synopsis ? maskSynopsis(row.synopsis, names) : null;
  }
  if (kinds.has('characters')) {
    const rows = await all<{ name: string; r2_key: string }>('SELECT name, r2_key FROM anime_character WHERE mal_id = ? ORDER BY favorites DESC LIMIT 2', [malId]);
    clues.characters = rows.map((c) => ({ name: displayName(c.name), portrait: mediaUrl(c.r2_key) }));
  }
  return clues;
}

/** play.guesses of an Anidle play: the guessed mal_id per try, SKIPPED for a try used by Skip. */
const SKIPPED = 0;

export async function anidleState(puzzle: PuzzleRow, playerKey: string): Promise<AnidleState> {
  const play = await readPlay(puzzle.id, playerKey);
  const guessIds = play ? (JSON.parse(play.guesses) as number[]) : [];
  const anime = await loadAnidle([Number(puzzle.answer_id), ...guessIds.filter((id) => id !== SKIPPED)]);
  const answer = anime.get(Number(puzzle.answer_id));
  if (!answer) throw new HttpError(500, 'An answer is missing from the database.');
  const guesses = guessIds.flatMap((id) => {
    if (id === SKIPPED) return [null];
    const guess = anime.get(id);
    return guess ? [compareAnidle(answer, guess)] : [];
  });
  const solved = Boolean(play?.solved);
  const finished = solved || guesses.length >= ANIDLE_MAX_GUESSES;
  const unlocked = new Set(ANIDLE_CLUES.filter((c) => finished || guesses.length >= c.after).map((c) => c.kind));
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
    clues: await anidleClues(answer.malId, unlocked, answer.cover),
    answer: finished ? answerInfo(answer) : null,
  };
}

export async function anidleGuess(puzzle: PuzzleRow, playerKey: string, malId: number): Promise<AnidleState> {
  const before = await anidleState(puzzle, playerKey);
  if (before.finished) throw new HttpError(409, 'This puzzle is already finished.');
  if (before.guesses.some((g) => g?.malId === malId)) throw new HttpError(409, 'You already guessed that title.');
  await assertPlayable(malId);

  const anime = await loadAnidle([Number(puzzle.answer_id), malId]);
  const feedback = compareAnidle(anime.get(Number(puzzle.answer_id))!, anime.get(malId)!);
  const guesses = [...before.guesses.map((g) => g?.malId ?? SKIPPED), malId];
  const finished = feedback.correct || guesses.length >= ANIDLE_MAX_GUESSES;
  await writePlay(puzzle.id, playerKey, { guesses, solved: feedback.correct ? 1 : 0, score: finished ? anidleScore(feedback.correct, guesses.length) : null, finished });
  return anidleState(puzzle, playerKey);
}

/** Skip: uses up every try until the next clue (without guessing a title), so that clue opens right away. */
export async function anidleSkip(puzzle: PuzzleRow, playerKey: string): Promise<AnidleState> {
  const before = await anidleState(puzzle, playerKey);
  if (before.finished) throw new HttpError(409, 'This puzzle is already finished.');
  const next = ANIDLE_CLUES.find((c) => c.after > before.guesses.length);
  if (!next) throw new HttpError(409, 'Every clue is already open.');
  const guesses = [...before.guesses.map((g) => g?.malId ?? SKIPPED), ...Array.from({ length: next.after - before.guesses.length }, () => SKIPPED)];
  await writePlay(puzzle.id, playerKey, { guesses, solved: 0, score: null, finished: false });
  return anidleState(puzzle, playerKey);
}
