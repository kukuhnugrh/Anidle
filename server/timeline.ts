import type { Pool } from '../shared/catalog.js';
import { ROUND_COUNT, roundMaxPoints, TIMELINE_SIZE } from '../shared/modes.js';
import { TIMELINE_POINT, timelinePlaced } from '../shared/timeline.js';
import { groupInserts, puzzleGroups } from './connections.js';
import { all } from './db.js';
import { boardOrder, insertUnlimited, loadAnidle, poolTitles, readPlay, shuffled, titleCard, writePlay, type PoolSpec, type PuzzleOptions, type PuzzleRow, type TitleCard } from './game.js';
import { HttpError } from './http.js';

// Timeline (beta, unlimited only; shared/timeline.ts): ROUND_COUNT rounds of TIMELINE_SIZE titles from
// different years and franchises, in puzzle_group (link '', mal_ids = the round's titles). play.guesses
// holds the order submitted per round (oldest first). Years leave the server once a round is submitted.

export interface TimelineRound {
  /** The round's titles: in an order fixed per puzzle, then as submitted. */
  tiles: TitleCard[];
  /** Once submitted: each title's year, and the right order (oldest first). */
  years: Record<number, number> | null;
  answer: number[] | null;
  placed: number;
  finished: boolean;
  points: number;
  max: number;
}

export interface TimelineState {
  id: string;
  mode: 'timeline';
  date: string | null;
  pool: Pool;
  rounds: TimelineRound[];
  current: number;
  finished: boolean;
  score: number | null;
}

const DRAW_BATCH = 80;
const DRAW_MAX_READS = 800;

/** A new puzzle: rounds of pool titles that each started airing in a different year. */
export async function timelinePuzzle(spec: PoolSpec, options: PuzzleOptions, playerKey: string): Promise<PuzzleRow> {
  const titles = shuffled(await poolTitles(spec));
  const rounds: number[][] = [];
  let round: Array<{ malId: number; year: number }> = [];
  const franchises = new Set<number>();
  for (let at = 0; at < Math.min(titles.length, DRAW_MAX_READS) && rounds.length < ROUND_COUNT; at += DRAW_BATCH) {
    const batch = titles.slice(at, at + DRAW_BATCH).filter((t) => !franchises.has(t.franchise));
    if (!batch.length) continue;
    const ids = batch.map((t) => t.malId);
    const rows = await all<{ mal_id: number; year: number }>(`SELECT mal_id, year FROM anime WHERE mal_id IN (${ids.map(() => '?').join(',')}) AND year IS NOT NULL`, ids);
    const years = new Map(rows.map((r) => [Number(r.mal_id), Number(r.year)]));
    for (const t of batch) {
      const year = years.get(t.malId);
      if (rounds.length === ROUND_COUNT || year === undefined || franchises.has(t.franchise) || round.some((r) => r.year === year)) continue;
      franchises.add(t.franchise);
      round.push({ malId: t.malId, year });
      if (round.length === TIMELINE_SIZE) {
        rounds.push(round.map((r) => r.malId));
        round = [];
      }
    }
  }
  if (rounds.length < ROUND_COUNT) throw new HttpError(404, 'This pool is too small for Timeline. Try a bigger pool or fewer filters.');
  return insertUnlimited('timeline', spec, options, playerKey, rounds[0]![0]!, (id) => groupInserts(id, rounds.map((malIds) => ({ link: '', malIds }))));
}

async function evaluate(puzzle: PuzzleRow, orders: number[][]): Promise<{ state: TimelineState; placed: number }> {
  const groups = await puzzleGroups(puzzle.id, ROUND_COUNT);
  const anime = await loadAnidle(groups.flatMap((g) => g.malIds));
  const yearOf = (malId: number) => anime.get(malId)?.year ?? 0;
  const rounds = groups.map((g, i): TimelineRound => {
    const order = orders[i] ?? null;
    const answer = [...g.malIds].sort((a, b) => yearOf(a) - yearOf(b));
    const placed = order ? timelinePlaced(order, answer) : 0;
    return {
      tiles: (order ?? boardOrder(puzzle.id, g.malIds)).map((malId) => titleCard(anime, malId)),
      years: order ? Object.fromEntries(g.malIds.map((id) => [id, yearOf(id)])) : null,
      answer: order ? answer : null,
      placed,
      finished: order !== null,
      points: placed * TIMELINE_POINT,
      max: roundMaxPoints('timeline'),
    };
  });
  const current = rounds.findIndex((r) => !r.finished);
  const finished = current < 0;
  return {
    state: {
      id: puzzle.id,
      mode: 'timeline',
      date: puzzle.date,
      pool: puzzle.pool,
      rounds,
      current: finished ? rounds.length : current,
      finished,
      score: finished ? rounds.reduce((sum, r) => sum + r.points, 0) : null,
    },
    placed: rounds.reduce((sum, r) => sum + r.placed, 0),
  };
}

const storedOrders = async (puzzleId: string, playerKey: string): Promise<number[][]> => {
  const play = await readPlay(puzzleId, playerKey);
  return play ? (JSON.parse(play.guesses) as number[][]) : [];
};

export async function timelineState(puzzle: PuzzleRow, playerKey: string): Promise<TimelineState> {
  return (await evaluate(puzzle, await storedOrders(puzzle.id, playerKey))).state;
}

/** The current round's one submission: its titles, oldest first. */
export async function timelineMove(puzzle: PuzzleRow, playerKey: string, round: number, order: number[]): Promise<TimelineState> {
  const orders = await storedOrders(puzzle.id, playerKey);
  const { state: before } = await evaluate(puzzle, orders);
  if (before.finished) throw new HttpError(409, 'This puzzle is already finished.');
  if (round !== before.current) throw new HttpError(409, 'That round is already over or has not started.');
  const ids = before.rounds[round]!.tiles.map((t) => t.malId);
  if (order.length !== ids.length || new Set(order).size !== ids.length || !order.every((id) => ids.includes(id))) throw new HttpError(400, "Send the round's titles in your order.");
  const next = [...orders, order];
  const { state, placed } = await evaluate(puzzle, next);
  await writePlay(puzzle.id, playerKey, { guesses: next, solved: placed, score: state.score, finished: state.finished });
  return state;
}
