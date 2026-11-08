import { isCorrect, maskSynopsis } from '../shared/anidle.js';
import type { Difficulty, Pool } from '../shared/catalog.js';
import { displayName } from '../shared/characters.js';
import { ROUND_COUNT, roundMaxPoints, roundTries } from '../shared/modes.js';
import { titleHint } from '../shared/normalize.js';
import { SYNOPSIS_GUESSES, SYNOPSIS_MIN_SENTENCES, synopsisClueCount, synopsisPoints, synopsisSentences } from '../shared/synopsis.js';
import { all } from './db.js';
import {
  alsoAccepted,
  answerInfo,
  assertPlayable,
  insertUnlimited,
  loadAnidle,
  poolTitles,
  readPlay,
  shuffled,
  writePlay,
  type AnswerInfo,
  type LoadedAnime,
  type PoolSpec,
  type PoolTitle,
  type PuzzleOptions,
  type PuzzleRow,
} from './game.js';
import { HttpError } from './http.js';
import type { RoundMove } from './rounds.js';

// Synopsis (beta, unlimited only; shared/synopsis.ts): ROUND_COUNT rounds of one title (puzzle_round),
// staged easy → medium → hard like the other round modes. The first sentence of its masked synopsis
// shows; the player may open the next ones, then the show's facts and its title's first letters (clues),
// and has SYNOPSIS_GUESSES guesses. play.guesses holds StoredRound[]: g = the guess that ended the round
// (right, the last wrong one, or 0 = gave up; null = still open), c = clues opened, w = wrong guesses that
// left it open (absent in plays from before there were several guesses). Only opened clues leave the server.

interface StoredRound {
  g: number | null;
  c: number;
  w?: number[];
}

export interface SynopsisRound {
  /** Sentences opened so far (every one once the round is over). */
  sentences: string[];
  /** Sentences the round has: the first plus total - 1 sentence clues, then SYNOPSIS_EXTRA_CLUES. */
  total: number;
  clues: number;
  /** The show's year, studios and genres (tags included), once that clue is opened. */
  facts: { year: number | null; studios: string[]; genres: string[] } | null;
  /** The masked title ("N_____"), once that clue is opened. */
  hint: { title: string; english: string | null } | null;
  difficulty: Difficulty;
  /** Wrong guesses that left the round open, in order. */
  misses: Array<{ malId: number; title: string }>;
  /** The guess that ended the round: right, or the last wrong one. */
  guess: { malId: number; title: string } | null;
  gaveUp: boolean;
  solved: boolean;
  finished: boolean;
  points: number;
  max: number;
  /** Only once the round is over. */
  answer: AnswerInfo | null;
  /** Once the round is over: the other entries a guess would have counted for (seasons, movies, spin-offs, franchise), oldest first. */
  alsoAccepted: string[];
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

/** A random show of `spec`'s pool outside `franchises` whose synopsis has SYNOPSIS_MIN_SENTENCES, or null. */
async function drawTitle(spec: PoolSpec, franchises: ReadonlySet<number>): Promise<PoolTitle | null> {
  const titles = shuffled((await poolTitles(spec)).filter((t) => !franchises.has(t.franchise)));
  for (let at = 0; at < Math.min(titles.length, DRAW_MAX_READS); at += DRAW_BATCH) {
    const batch = titles.slice(at, at + DRAW_BATCH);
    const ids = batch.map((t) => t.malId);
    const rows = await all<{ mal_id: number; synopsis: string }>(`SELECT mal_id, synopsis FROM anime WHERE mal_id IN (${marks(ids)}) AND synopsis IS NOT NULL AND synopsis != ''`, ids);
    const long = new Set(rows.filter((r) => synopsisSentences(maskSynopsis(r.synopsis, [])).length >= SYNOPSIS_MIN_SENTENCES).map((r) => Number(r.mal_id)));
    const hit = batch.find((t) => long.has(t.malId));
    if (hit) return hit;
  }
  return null;
}

/**
 * A new puzzle: ROUND_COUNT shows from different franchises whose synopsis has SYNOPSIS_MIN_SENTENCES,
 * round n from roundDifficulties (easy, medium, hard for every difficulty), widened per roundTries.
 */
export async function synopsisPuzzle(spec: PoolSpec, options: PuzzleOptions, playerKey: string): Promise<PuzzleRow> {
  const picked: number[] = [];
  const franchises = new Set<number>();
  for (let round = 0; round < ROUND_COUNT; round++) {
    let title: PoolTitle | null = null;
    for (const difficulties of roundTries(spec.difficulties, round)) {
      title = await drawTitle({ ...spec, difficulties }, franchises);
      if (title) break;
    }
    if (!title) throw new HttpError(404, 'This pool has too few titles with a synopsis. Try a bigger pool or fewer filters.');
    franchises.add(title.franchise);
    picked.push(title.malId);
  }
  return insertUnlimited('synopsis', spec, options, playerKey, picked[0]!, (id) =>
    picked.map((malId, round) => ({ sql: 'INSERT INTO puzzle_round (puzzle_id, round, mal_id) VALUES (?, ?, ?)', args: [id, round, malId] })),
  );
}

interface Evaluated {
  state: SynopsisState;
  solvedRounds: number;
  /** Each round's answer, for judging the next guess. */
  answers: LoadedAnime[];
}

async function evaluate(puzzle: PuzzleRow, stored: StoredRound[]): Promise<Evaluated> {
  const ids = (await all<{ mal_id: number }>('SELECT mal_id FROM puzzle_round WHERE puzzle_id = ? ORDER BY round', [puzzle.id])).map((r) => Number(r.mal_id));
  if (ids.length !== ROUND_COUNT) throw new HttpError(500, 'Puzzle data is incomplete.');
  const guessed = stored.flatMap((s) => [...(s.w ?? []), ...(s.g ? [s.g] : [])]);
  const over = ids.filter((_, i) => (stored[i]?.g ?? null) !== null);
  const [sentences, anime, accepted] = await Promise.all([maskedSentences(ids), loadAnidle([...ids, ...guessed]), alsoAccepted(over)]);
  const named = (malId: number) => ({ malId, title: anime.get(malId)?.title ?? `#${malId}` });
  const answers = ids.map((malId) => {
    const answer = anime.get(malId);
    if (!answer) throw new HttpError(500, 'An answer is missing from the database.');
    return answer;
  });
  const rounds = answers.map((answer, i): SynopsisRound => {
    const text = sentences.get(answer.malId) ?? [];
    const played = stored[i] ?? { g: null, c: 0 };
    const misses = played.w ?? [];
    const last = played.g ? anime.get(played.g) : undefined;
    const solved = last !== undefined && isCorrect(answer, last);
    const finished = played.g !== null;
    const info = answerInfo(answer);
    // Clues open in order: sentences 2..total, then the facts, then the title's first letters.
    const sentenceClues = text.length - 1;
    return {
      sentences: finished ? text : text.slice(0, 1 + Math.min(played.c, sentenceClues)),
      total: text.length,
      clues: played.c,
      facts: played.c > sentenceClues ? { year: answer.year, studios: answer.studios, genres: [...answer.genres, ...answer.tags] } : null,
      hint: played.c > sentenceClues + 1 ? { title: titleHint(answer.title), english: answer.titleEn ? titleHint(answer.titleEn) : null } : null,
      difficulty: info.difficulty,
      misses: misses.map(named),
      guess: played.g ? named(played.g) : null,
      gaveUp: played.g === 0,
      solved,
      finished,
      points: synopsisPoints(solved, played.c, misses.length),
      max: roundMaxPoints('synopsis'),
      answer: finished ? info : null,
      alsoAccepted: finished ? (accepted.get(answer.malId) ?? []) : [],
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
    answers,
  };
}

const storedRounds = async (puzzleId: string, playerKey: string): Promise<StoredRound[]> => {
  const play = await readPlay(puzzleId, playerKey);
  return play ? (JSON.parse(play.guesses) as StoredRound[]) : [];
};

export async function synopsisState(puzzle: PuzzleRow, playerKey: string): Promise<SynopsisState> {
  return (await evaluate(puzzle, await storedRounds(puzzle.id, playerKey))).state;
}

/** One move in the current round: open the next clue, guess (a wrong one keeps the round open until the last), or give up. */
export async function synopsisMove(puzzle: PuzzleRow, playerKey: string, round: number, move: RoundMove): Promise<SynopsisState> {
  const stored = await storedRounds(puzzle.id, playerKey);
  const { state: before, answers } = await evaluate(puzzle, stored);
  if (before.finished) throw new HttpError(409, 'This puzzle is already finished.');
  if (round !== before.current) throw new HttpError(409, 'That round is already over or has not started.');
  const next = Array.from({ length: ROUND_COUNT }, (_, i): StoredRound => stored[i] ?? { g: null, c: 0 });
  const played = { ...next[round]!, w: [...(next[round]!.w ?? [])] };
  if (move.kind === 'clue') {
    if (played.c >= synopsisClueCount(before.rounds[round]!.total)) throw new HttpError(409, 'Every clue is already open.');
    played.c++;
  } else if (move.kind === 'giveUp') played.g = 0;
  else {
    await assertPlayable(move.malId);
    if (played.w.includes(move.malId)) throw new HttpError(409, 'You already tried that one.');
    const guessed = (await loadAnidle([move.malId])).get(move.malId);
    const right = guessed !== undefined && isCorrect(answers[round]!, guessed);
    if (right || played.w.length + 1 >= SYNOPSIS_GUESSES) played.g = move.malId;
    else played.w.push(move.malId);
  }
  next[round] = played;
  const after = await evaluate(puzzle, next);
  await writePlay(puzzle.id, playerKey, { guesses: next, solved: after.solvedRounds, score: after.state.score, finished: after.state.finished });
  return after.state;
}
