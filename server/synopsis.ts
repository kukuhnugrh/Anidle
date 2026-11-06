import { isCorrect, maskSynopsis } from '../shared/anidle.js';
import type { Difficulty, Pool } from '../shared/catalog.js';
import { displayName } from '../shared/characters.js';
import { ROUND_COUNT, roundMaxPoints } from '../shared/modes.js';
import { SYNOPSIS_MIN_SENTENCES, synopsisPoints, synopsisSentences } from '../shared/synopsis.js';
import { all } from './db.js';
import { answerInfo, assertPlayable, insertUnlimited, loadAnidle, poolTitles, readPlay, shuffled, writePlay, type AnswerInfo, type PoolSpec, type PuzzleOptions, type PuzzleRow } from './game.js';
import { HttpError } from './http.js';
import type { RoundMove } from './rounds.js';

// Synopsis (beta, unlimited only; shared/synopsis.ts): ROUND_COUNT rounds of one title (puzzle_round).
// The first sentence of its masked synopsis shows; the player may open the next ones (clues) and makes
// one guess. play.guesses holds StoredRound[] as in Guess the Anime: g = guessed mal_id (0 = gave up,
// null = not yet), c = extra sentences opened. Only opened sentences leave the server.

interface StoredRound {
  g: number | null;
  c: number;
}

export interface SynopsisRound {
  /** Sentences opened so far (every one once the round is over). */
  sentences: string[];
  /** Sentences the round has: the first plus total - 1 clues. */
  total: number;
  clues: number;
  difficulty: Difficulty;
  guess: { malId: number; title: string } | null;
  gaveUp: boolean;
  solved: boolean;
  finished: boolean;
  points: number;
  max: number;
  /** Only once the round is over. */
  answer: AnswerInfo | null;
}

export interface SynopsisState {
  id: string;
  mode: 'synopsis';
  date: string | null;
  pool: Pool;
  rounds: SynopsisRound[];
  /** First unfinished round, rounds.length once the puzzle is over. */
  current: number;
  finished: boolean;
  score: number | null;
}

/** Best-known characters whose names are masked too (slots 0.. are stored by favorites, so this reads a few rows). */
const MASKED_CHARACTERS = 10;
/** Shows read per query while drawing; a pool rarely needs more than one batch. */
const DRAW_BATCH = 40;
const DRAW_MAX_READS = 400;

const marks = (ids: readonly unknown[]) => ids.map(() => '?').join(',');

/** Each show's synopsis as sentences, with its titles and best-known characters' names masked. */
async function maskedSentences(ids: number[]): Promise<Map<number, string[]>> {
  const [rows, characters] = await Promise.all([
    all<{ mal_id: number; synopsis: string | null; title: string; title_en: string | null; title_ja: string | null; synonyms: string }>(
      `SELECT mal_id, synopsis, title, title_en, title_ja, synonyms FROM anime WHERE mal_id IN (${marks(ids)})`,
      ids,
    ),
    all<{ mal_id: number; name: string }>(`SELECT mal_id, name FROM anime_character WHERE mal_id IN (${marks(ids)}) AND slot < ?`, [...ids, MASKED_CHARACTERS]),
  ]);
  const charactersOf = Map.groupBy(characters, (c) => Number(c.mal_id));
  return new Map(
    rows.map((r) => {
      const id = Number(r.mal_id);
      const names = [r.title, r.title_en, r.title_ja, ...(JSON.parse(r.synonyms) as string[]), ...(charactersOf.get(id) ?? []).map((c) => displayName(c.name))];
      return [id, synopsisSentences(maskSynopsis(r.synopsis ?? '', names.filter((n): n is string => Boolean(n))))];
    }),
  );
}

/** A new puzzle: ROUND_COUNT shows of the pool from different franchises whose synopsis has SYNOPSIS_MIN_SENTENCES. */
export async function synopsisPuzzle(spec: PoolSpec, options: PuzzleOptions, playerKey: string): Promise<PuzzleRow> {
  const titles = shuffled(await poolTitles(spec));
  const picked: number[] = [];
  const franchises = new Set<number>();
  for (let at = 0; at < Math.min(titles.length, DRAW_MAX_READS) && picked.length < ROUND_COUNT; at += DRAW_BATCH) {
    const batch = titles.slice(at, at + DRAW_BATCH).filter((t) => !franchises.has(t.franchise));
    if (!batch.length) continue;
    const ids = batch.map((t) => t.malId);
    const rows = await all<{ mal_id: number; synopsis: string }>(`SELECT mal_id, synopsis FROM anime WHERE mal_id IN (${marks(ids)}) AND synopsis IS NOT NULL AND synopsis != ''`, ids);
    const long = new Set(rows.filter((r) => synopsisSentences(maskSynopsis(r.synopsis, [])).length >= SYNOPSIS_MIN_SENTENCES).map((r) => Number(r.mal_id)));
    for (const t of batch) {
      if (picked.length === ROUND_COUNT || franchises.has(t.franchise) || !long.has(t.malId)) continue;
      franchises.add(t.franchise);
      picked.push(t.malId);
    }
  }
  if (picked.length < ROUND_COUNT) throw new HttpError(404, 'This pool has too few titles with a synopsis. Try a bigger pool or fewer filters.');
  return insertUnlimited('synopsis', spec, options, playerKey, picked[0]!, (id) =>
    picked.map((malId, round) => ({ sql: 'INSERT INTO puzzle_round (puzzle_id, round, mal_id) VALUES (?, ?, ?)', args: [id, round, malId] })),
  );
}

interface Evaluated {
  state: SynopsisState;
  solvedRounds: number;
}

async function evaluate(puzzle: PuzzleRow, stored: StoredRound[]): Promise<Evaluated> {
  const ids = (await all<{ mal_id: number }>('SELECT mal_id FROM puzzle_round WHERE puzzle_id = ? ORDER BY round', [puzzle.id])).map((r) => Number(r.mal_id));
  if (ids.length !== ROUND_COUNT) throw new HttpError(500, 'Puzzle data is incomplete.');
  const [sentences, anime] = await Promise.all([maskedSentences(ids), loadAnidle([...ids, ...stored.flatMap((s) => (s.g ? [s.g] : []))])]);
  const rounds = ids.map((malId, i): SynopsisRound => {
    const answer = anime.get(malId);
    if (!answer) throw new HttpError(500, 'An answer is missing from the database.');
    const text = sentences.get(malId) ?? [];
    const played = stored[i] ?? { g: null, c: 0 };
    const guessed = played.g ? anime.get(played.g) : undefined;
    const solved = guessed !== undefined && isCorrect(answer, guessed);
    const finished = played.g !== null;
    const info = answerInfo(answer);
    return {
      sentences: finished ? text : text.slice(0, 1 + played.c),
      total: text.length,
      clues: played.c,
      difficulty: info.difficulty,
      guess: played.g ? { malId: played.g, title: guessed?.title ?? `#${played.g}` } : null,
      gaveUp: played.g === 0,
      solved,
      finished,
      points: synopsisPoints(solved, played.c),
      max: roundMaxPoints('synopsis'),
      answer: finished ? info : null,
    };
  });
  const current = rounds.findIndex((r) => !r.finished);
  const finished = current < 0;
  return {
    state: {
      id: puzzle.id,
      mode: 'synopsis',
      date: puzzle.date,
      pool: puzzle.pool,
      rounds,
      current: finished ? rounds.length : current,
      finished,
      score: finished ? rounds.reduce((sum, r) => sum + r.points, 0) : null,
    },
    solvedRounds: rounds.filter((r) => r.solved).length,
  };
}

const storedRounds = async (puzzleId: string, playerKey: string): Promise<StoredRound[]> => {
  const play = await readPlay(puzzleId, playerKey);
  return play ? (JSON.parse(play.guesses) as StoredRound[]) : [];
};

export async function synopsisState(puzzle: PuzzleRow, playerKey: string): Promise<SynopsisState> {
  return (await evaluate(puzzle, await storedRounds(puzzle.id, playerKey))).state;
}

/** One move in the current round: open the next sentence, guess (once), or give up. */
export async function synopsisMove(puzzle: PuzzleRow, playerKey: string, round: number, move: RoundMove): Promise<SynopsisState> {
  const stored = await storedRounds(puzzle.id, playerKey);
  const before = (await evaluate(puzzle, stored)).state;
  if (before.finished) throw new HttpError(409, 'This puzzle is already finished.');
  if (round !== before.current) throw new HttpError(409, 'That round is already over or has not started.');
  const next = Array.from({ length: ROUND_COUNT }, (_, i) => stored[i] ?? { g: null, c: 0 });
  const played = { ...next[round]! };
  if (move.kind === 'clue') {
    if (played.c >= before.rounds[round]!.total - 1) throw new HttpError(409, 'Every sentence is already open.');
    played.c++;
  } else if (move.kind === 'giveUp') played.g = 0;
  else {
    await assertPlayable(move.malId);
    played.g = move.malId;
  }
  next[round] = played;
  const after = await evaluate(puzzle, next);
  await writePlay(puzzle.id, playerKey, { guesses: next, solved: after.solvedRounds, score: after.state.score, finished: after.state.finished });
  return after.state;
}
