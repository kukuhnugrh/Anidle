import type { Pool } from '../shared/catalog.js';
import { HIGHER_LOWER_MIN_GAP, HIGHER_LOWER_POINT, higherLowerRight, type HigherLowerPick } from '../shared/higherlower.js';
import { HIGHER_LOWER_STEPS } from '../shared/modes.js';
import { all } from './db.js';
import { insertUnlimited, loadAnidle, poolTitles, readPlay, shuffled, titleCard, writePlay, type PoolSpec, type PuzzleOptions, type PuzzleRow, type TitleCard } from './game.js';
import { HttpError } from './http.js';

// Higher or Lower (beta, unlimited only; shared/higherlower.ts): a run of HIGHER_LOWER_STEPS + 1 titles
// from different franchises (puzzle_round, round = position), neighbours HIGHER_LOWER_MIN_GAP apart in
// MAL score. play.guesses holds HigherLowerPick[]: one per step taken. Only the titles reached and the
// scores already compared leave the server.

export interface HigherLowerCard extends TitleCard {
  /** MAL score; null while it is the one being guessed. */
  score: number | null;
}

export interface HigherLowerStep {
  pick: HigherLowerPick;
  right: boolean;
}

export interface HigherLowerState {
  id: string;
  mode: 'higherlower';
  date: string | null;
  pool: Pool;
  /** The run so far: every title compared, plus the next one (its score hidden until the run ends). */
  cards: HigherLowerCard[];
  steps: HigherLowerStep[];
  maxSteps: number;
  /** Right picks: the run ends at the first wrong one. */
  streak: number;
  finished: boolean;
  score: number | null;
}

const DRAW_BATCH = 80;
const DRAW_MAX_READS = 800;

/** A new run: pool titles with a MAL score, each from its own franchise and HIGHER_LOWER_MIN_GAP from the one before. */
export async function higherLowerPuzzle(spec: PoolSpec, options: PuzzleOptions, playerKey: string): Promise<PuzzleRow> {
  const titles = shuffled(await poolTitles(spec));
  const run: Array<{ malId: number; score: number }> = [];
  const franchises = new Set<number>();
  for (let at = 0; at < Math.min(titles.length, DRAW_MAX_READS) && run.length <= HIGHER_LOWER_STEPS; at += DRAW_BATCH) {
    const batch = titles.slice(at, at + DRAW_BATCH).filter((t) => !franchises.has(t.franchise));
    if (!batch.length) continue;
    const ids = batch.map((t) => t.malId);
    const rows = await all<{ mal_id: number; score: number }>(`SELECT mal_id, score FROM anime WHERE mal_id IN (${ids.map(() => '?').join(',')}) AND score IS NOT NULL`, ids);
    const scores = new Map(rows.map((r) => [Number(r.mal_id), Number(r.score)]));
    for (const t of batch) {
      const score = scores.get(t.malId);
      const last = run.at(-1);
      if (run.length > HIGHER_LOWER_STEPS || score === undefined || franchises.has(t.franchise) || (last && Math.abs(score - last.score) < HIGHER_LOWER_MIN_GAP)) continue;
      franchises.add(t.franchise);
      run.push({ malId: t.malId, score });
    }
  }
  if (run.length <= HIGHER_LOWER_STEPS) throw new HttpError(404, 'This pool is too small for Higher or Lower. Try a bigger pool or fewer filters.');
  return insertUnlimited('higherlower', spec, options, playerKey, run[0]!.malId, (id) =>
    run.map((t, round) => ({ sql: 'INSERT INTO puzzle_round (puzzle_id, round, mal_id) VALUES (?, ?, ?)', args: [id, round, t.malId] })),
  );
}

async function evaluate(puzzle: PuzzleRow, picks: HigherLowerPick[]): Promise<HigherLowerState> {
  const ids = (await all<{ mal_id: number }>('SELECT mal_id FROM puzzle_round WHERE puzzle_id = ? ORDER BY round', [puzzle.id])).map((r) => Number(r.mal_id));
  if (ids.length !== HIGHER_LOWER_STEPS + 1) throw new HttpError(500, 'Puzzle data is incomplete.');
  // Only the titles reached: the run so far and the next one.
  const reached = ids.slice(0, picks.length + 2);
  const anime = await loadAnidle(reached);
  const scoreOf = (malId: number) => anime.get(malId)?.score ?? 0;
  const steps = picks.map((pick, i): HigherLowerStep => ({ pick, right: higherLowerRight(pick, scoreOf(ids[i]!), scoreOf(ids[i + 1]!)) }));
  const streak = steps.filter((s) => s.right).length;
  const finished = steps.some((s) => !s.right) || steps.length === HIGHER_LOWER_STEPS;
  // A finished run ends on its last compared title; one still going shows the next one, score hidden.
  const shown = finished ? ids.slice(0, steps.length + 1) : reached;
  return {
    id: puzzle.id,
    mode: 'higherlower',
    date: puzzle.date,
    pool: puzzle.pool,
    cards: shown.map((malId, i) => ({ ...titleCard(anime, malId), score: finished || i < shown.length - 1 ? scoreOf(malId) : null })),
    steps,
    maxSteps: HIGHER_LOWER_STEPS,
    streak,
    finished,
    score: finished ? streak * HIGHER_LOWER_POINT : null,
  };
}

const storedPicks = async (puzzleId: string, playerKey: string): Promise<HigherLowerPick[]> => {
  const play = await readPlay(puzzleId, playerKey);
  return play ? (JSON.parse(play.guesses) as HigherLowerPick[]) : [];
};

export async function higherLowerState(puzzle: PuzzleRow, playerKey: string): Promise<HigherLowerState> {
  return evaluate(puzzle, await storedPicks(puzzle.id, playerKey));
}

/** The next step: whether the next title scores higher or lower than the last. */
export async function higherLowerMove(puzzle: PuzzleRow, playerKey: string, pick: HigherLowerPick): Promise<HigherLowerState> {
  const picks = await storedPicks(puzzle.id, playerKey);
  if ((await evaluate(puzzle, picks)).finished) throw new HttpError(409, 'This run is already over.');
  const next = [...picks, pick];
  const state = await evaluate(puzzle, next);
  await writePlay(puzzle.id, playerKey, { guesses: next, solved: state.streak, score: state.score, finished: state.finished });
  return state;
}
