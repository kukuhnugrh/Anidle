import type { Pool } from '../shared/catalog.js';
import { linkLabel, type LinkKind } from '../shared/connections.js';
import { ODD_ONE_OUT_ROUNDS } from '../shared/modes.js';
import { drawOddRounds, ODD_ONE_OUT_POINTS } from '../shared/oddoneout.js';
import { groupInserts, linkCandidates, puzzleGroups, puzzleLinkKinds } from './connections.js';
import { boardOrder, insertUnlimited, loadAnidle, readPlay, titleCard, writePlay, type PoolSpec, type PuzzleOptions, type PuzzleRow, type TitleCard } from './game.js';
import { HttpError } from './http.js';

// Odd One Out (beta, unlimited only; shared/oddoneout.ts): ODD_ONE_OUT_ROUNDS rounds in puzzle_group
// (link = what the others share, mal_ids = the round's titles, odd one last). play.guesses holds the
// mal_id picked per round. A round's answer and link leave the server once it is picked.

export interface OddOneOutRound {
  /** The round's titles in an order fixed per puzzle. */
  tiles: TitleCard[];
  pick: number | null;
  /** Once picked: the odd title and what the others share. */
  odd: number | null;
  label: string | null;
  solved: boolean;
  finished: boolean;
  points: number;
}

export interface OddOneOutState {
  id: string;
  mode: 'oddoneout';
  date: string | null;
  pool: Pool;
  rounds: OddOneOutRound[];
  current: number;
  finished: boolean;
  score: number | null;
  /** The link kinds the rounds were drawn from (every kind unless the player narrowed them). */
  links: LinkKind[];
}

export async function oddOneOutPuzzle(spec: PoolSpec, options: PuzzleOptions, playerKey: string): Promise<PuzzleRow> {
  const rounds = drawOddRounds(await linkCandidates(spec, options.links), (size) => Math.floor(Math.random() * size));
  if (!rounds)
    throw new HttpError(
      404,
      options.links ? 'Not enough shared links of these types in this pool. Pick more link types, a bigger pool or fewer filters.' : 'This pool is too small for Odd One Out. Try a bigger pool or fewer filters.',
    );
  return insertUnlimited('oddoneout', spec, options, playerKey, rounds[0]!.malIds.at(-1)!, (id) => groupInserts(id, rounds));
}

async function evaluate(puzzle: PuzzleRow, picks: number[]): Promise<OddOneOutState> {
  const groups = await puzzleGroups(puzzle.id, ODD_ONE_OUT_ROUNDS);
  const anime = await loadAnidle(groups.flatMap((g) => g.malIds));
  const rounds = groups.map((g, i): OddOneOutRound => {
    const odd = g.malIds.at(-1)!;
    const pick = picks[i] ?? null;
    const finished = pick !== null;
    const solved = pick === odd;
    return {
      tiles: boardOrder(puzzle.id, g.malIds).map((malId) => titleCard(anime, malId)),
      pick,
      odd: finished ? odd : null,
      label: finished ? linkLabel(g.link) : null,
      solved,
      finished,
      points: solved ? ODD_ONE_OUT_POINTS : 0,
    };
  });
  const current = rounds.findIndex((r) => !r.finished);
  const finished = current < 0;
  return {
    id: puzzle.id,
    mode: 'oddoneout',
    date: puzzle.date,
    pool: puzzle.pool,
    rounds,
    current: finished ? rounds.length : current,
    finished,
    score: finished ? rounds.reduce((sum, r) => sum + r.points, 0) : null,
    links: puzzleLinkKinds(puzzle),
  };
}

const storedPicks = async (puzzleId: string, playerKey: string): Promise<number[]> => {
  const play = await readPlay(puzzleId, playerKey);
  return play ? (JSON.parse(play.guesses) as number[]) : [];
};

export async function oddOneOutState(puzzle: PuzzleRow, playerKey: string): Promise<OddOneOutState> {
  return evaluate(puzzle, await storedPicks(puzzle.id, playerKey));
}

/** The current round's one pick: the title that does not belong. */
export async function oddOneOutMove(puzzle: PuzzleRow, playerKey: string, round: number, malId: number): Promise<OddOneOutState> {
  const picks = await storedPicks(puzzle.id, playerKey);
  const before = await evaluate(puzzle, picks);
  if (before.finished) throw new HttpError(409, 'This puzzle is already finished.');
  if (round !== before.current) throw new HttpError(409, 'That round is already over or has not started.');
  if (!before.rounds[round]!.tiles.some((t) => t.malId === malId)) throw new HttpError(400, 'Pick one of the round’s titles.');
  const next = [...picks, malId];
  const state = await evaluate(puzzle, next);
  await writePlay(puzzle.id, playerKey, { guesses: next, solved: state.rounds.filter((r) => r.solved).length, score: state.score, finished: state.finished });
  return state;
}
