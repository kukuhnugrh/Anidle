import { isCorrect } from '../shared/anidle.js';
import type { Pool } from '../shared/catalog.js';
import { ROUND_COUNT, ROUND_STAGES, roundPoints, type RoundMode } from '../shared/modes.js';
import { all } from './db.js';
import { answerInfo, assertPlayable, loadAnidle, readPlay, writePlay, type AnswerInfo, type PuzzleRow } from './game.js';
import { HttpError } from './http.js';
import { mediaUrl } from './media.js';

// Staged modes (Screenshot): ROUND_COUNT rounds of one title, each attempt unlocks the next stage of
// ROUND_STAGES[mode]. Stored per player in play.guesses as number[][] (one list per round, 0 = skip).

export interface RoundPlayState {
  /** Screenshot: [one frame]. */
  media: string[];
  /** Wrong guesses, skips (null) and, when solved, the correct guess last. */
  attempts: Array<{ malId: number; title: string } | null>;
  solved: boolean;
  finished: boolean;
  points: number;
  /** Only once the round is over. */
  answer: AnswerInfo | null;
}

export interface RoundState {
  id: string;
  mode: RoundMode;
  date: string | null;
  pool: Pool;
  /** What each attempt unlocks (the zoom factor). */
  stages: readonly number[];
  rounds: RoundPlayState[];
  /** First unfinished round, rounds.length once the puzzle is over. */
  current: number;
  finished: boolean;
  score: number | null;
  /** The player's own unlimited puzzle: a round whose media does not load may be swapped. */
  canReplace: boolean;
}

async function loadRounds(puzzleId: string): Promise<Array<{ malId: number; media: string[] }>> {
  const rounds = await all<{ mal_id: number }>('SELECT mal_id FROM puzzle_round WHERE puzzle_id = ? ORDER BY round', [puzzleId]);
  const ids = rounds.map((r) => Number(r.mal_id));
  const rows = await all<{ mal_id: number; r2_key: string }>(`SELECT mal_id, r2_key FROM anime_screenshot WHERE mal_id IN (${ids.map(() => '?').join(',')}) ORDER BY slot`, ids);
  const byTitle = Map.groupBy(rows, (r) => Number(r.mal_id));
  const loaded = ids.map((malId) => ({ malId, media: (byTitle.get(malId) ?? []).map((s) => mediaUrl(s.r2_key)) }));
  if (loaded.length !== ROUND_COUNT || loaded.some((r) => !r.media.length)) throw new HttpError(500, 'Puzzle data is incomplete.');
  return loaded;
}

interface Evaluated {
  state: RoundState;
  solvedRounds: number;
}

async function evaluate(puzzle: PuzzleRow, mode: RoundMode, playerKey: string, attempts: number[][]): Promise<Evaluated> {
  const stages = ROUND_STAGES[mode];
  const rounds = await loadRounds(puzzle.id);
  const anime = await loadAnidle([...rounds.map((r) => r.malId), ...attempts.flat().filter((id) => id > 0)]);
  const states = rounds.map((r, i): RoundPlayState => {
    const answer = anime.get(r.malId);
    if (!answer) throw new HttpError(500, 'An answer is missing from the database.');
    const tries = attempts[i] ?? [];
    const solvedAt = tries.findIndex((id) => {
      const guess = anime.get(id);
      return guess !== undefined && isCorrect(answer, guess);
    });
    const solved = solvedAt >= 0;
    const finished = solved || tries.length >= stages.length;
    return {
      media: r.media,
      attempts: tries.map((id) => (id > 0 ? { malId: id, title: anime.get(id)?.title ?? `#${id}` } : null)),
      solved,
      finished,
      points: roundPoints(solved ? solvedAt : null, stages.length),
      answer: finished ? answerInfo(answer) : null,
    };
  });
  const current = states.findIndex((s) => !s.finished);
  const finished = current < 0;
  return {
    state: {
      id: puzzle.id,
      mode,
      date: puzzle.date,
      pool: puzzle.pool,
      stages,
      rounds: states,
      current: finished ? states.length : current,
      finished,
      score: finished ? states.reduce((sum, s) => sum + s.points, 0) : null,
      canReplace: puzzle.date == null && puzzle.created_by === playerKey,
    },
    solvedRounds: states.filter((s) => s.solved).length,
  };
}

const storedAttempts = async (puzzleId: string, playerKey: string): Promise<number[][]> => {
  const play = await readPlay(puzzleId, playerKey);
  return play ? (JSON.parse(play.guesses) as number[][]) : [];
};

export async function roundState(puzzle: PuzzleRow, mode: RoundMode, playerKey: string): Promise<RoundState> {
  return (await evaluate(puzzle, mode, playerKey, await storedAttempts(puzzle.id, playerKey))).state;
}

/** A guess (`malId`) or a skip (`null`) in `round`, which must be the current one. */
export async function roundGuess(puzzle: PuzzleRow, mode: RoundMode, playerKey: string, round: number, malId: number | null): Promise<RoundState> {
  const attempts = await storedAttempts(puzzle.id, playerKey);
  const before = (await evaluate(puzzle, mode, playerKey, attempts)).state;
  if (before.finished) throw new HttpError(409, 'This puzzle is already finished.');
  if (round !== before.current) throw new HttpError(409, 'That round is already over or has not started.');
  const tries = attempts[round] ?? [];
  if (malId != null) {
    if (tries.includes(malId)) throw new HttpError(409, 'You already guessed that title this round.');
    await assertPlayable(malId);
  }
  attempts[round] = [...tries, malId ?? 0];
  const after = await evaluate(puzzle, mode, playerKey, attempts);
  await writePlay(puzzle.id, playerKey, { guesses: attempts, solved: after.solvedRounds, score: after.state.score, finished: after.state.finished });
  return after.state;
}
