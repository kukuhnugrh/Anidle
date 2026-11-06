import { randomUUID } from 'node:crypto';
import type { Pool } from '../shared/catalog.js';
import { CONNECTIONS_GROUP_SIZE, CONNECTIONS_MAX_MISTAKES, connectionsScore, drawBoard, judgeGuess, linkLabel } from '../shared/connections.js';
import { CONNECTIONS_GROUPS } from '../shared/modes.js';
import { catalogTraits } from './catalog.js';
import { seedOf } from './crypto.js';
import { all, db, nowIso } from './db.js';
import { loadAnidle, poolTitles, readPlay, writePlay, type PoolSpec, type PuzzleOptions, type PuzzleRow } from './game.js';
import { HttpError } from './http.js';

// Connections (beta, unlimited only; shared/connections.ts): one board of CONNECTIONS_GROUPS groups,
// stored in puzzle_group. play.guesses holds number[][]: every guess's titles, in order. A group's link
// only leaves the server once the group is found or the board is over.

export interface ConnectionsTile {
  malId: number;
  title: string;
  /** MAL's English title, when it differs from `title`. */
  titleEn: string | null;
  cover: string | null;
}

export interface ConnectionsGroup {
  /** 0 = easiest … CONNECTIONS_GROUPS - 1 = trickiest (the group's colour). */
  tier: number;
  label: string;
  malIds: number[];
  /** False for a group shown only because the board is over. */
  found: boolean;
}

export interface ConnectionsGuess {
  malIds: number[];
  /** The tier of the group it found, null for a mistake. */
  group: number | null;
  /** A mistake with all but one title from one group. */
  oneAway: boolean;
}

export interface ConnectionsState {
  id: string;
  mode: 'connections';
  date: string | null;
  pool: Pool;
  /** The board, in an order fixed per puzzle (the client may shuffle its own view). */
  tiles: ConnectionsTile[];
  /** Groups found, in the order found; once the board is over, the others follow. */
  groups: ConnectionsGroup[];
  guesses: ConnectionsGuess[];
  mistakes: number;
  maxMistakes: number;
  solved: boolean;
  finished: boolean;
  score: number | null;
}

/** A new unlimited board from the pool of `spec`, drawn among the links of catalog row 'traits'. */
export async function connectionsPuzzle(spec: PoolSpec, options: PuzzleOptions, playerKey: string): Promise<PuzzleRow> {
  const [titles, traits] = await Promise.all([poolTitles(spec), catalogTraits()]);
  const board = drawBoard(
    titles.map((t) => ({ malId: t.malId, franchise: t.franchise, links: traits[t.malId] ?? [] })),
    (size) => Math.floor(Math.random() * size),
  );
  if (!board) throw new HttpError(404, 'This pool is too small for Connections. Try a bigger pool or fewer filters.');
  const row: PuzzleRow = { id: randomUUID(), date: null, mode: 'connections', pool: spec.pool, answer_id: board[0]!.malIds[0]!, created_by: playerKey, options: JSON.stringify(options) };
  await db().batch(
    [
      {
        sql: 'INSERT INTO puzzle (id, date, mode, pool, answer_id, created_by, options, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        args: [row.id, row.date, row.mode, row.pool, row.answer_id, row.created_by, row.options, nowIso()],
      },
      ...board.map((g, grp) => ({ sql: 'INSERT INTO puzzle_group (puzzle_id, grp, link, mal_ids) VALUES (?, ?, ?, ?)', args: [row.id, grp, g.link, JSON.stringify(g.malIds)] })),
    ],
    'write',
  );
  return row;
}

interface Evaluated {
  state: ConnectionsState;
  /** Group ids per tier, for judging the next guess. */
  groupIds: number[][];
}

async function evaluate(puzzle: PuzzleRow, stored: number[][]): Promise<Evaluated> {
  const rows = await all<{ link: string; mal_ids: string }>('SELECT link, mal_ids FROM puzzle_group WHERE puzzle_id = ? ORDER BY grp', [puzzle.id]);
  if (rows.length !== CONNECTIONS_GROUPS) throw new HttpError(500, 'Puzzle data is incomplete.');
  const groupIds = rows.map((r) => JSON.parse(r.mal_ids) as number[]);
  const ids = groupIds.flat();
  const anime = await loadAnidle(ids);
  // Shuffled once per puzzle, so a reload keeps the board where it was.
  const order = new Map(ids.map((id) => [id, seedOf(`${puzzle.id}:${id}`)]));
  const tiles = [...ids]
    .sort((a, b) => (order.get(a)! < order.get(b)! ? -1 : 1))
    .map((malId): ConnectionsTile => {
      const a = anime.get(malId);
      if (!a) throw new HttpError(500, 'A title is missing from the database.');
      return { malId, title: a.title, titleEn: a.titleEn, cover: a.cover };
    });

  const guesses = stored.map((malIds): ConnectionsGuess => ({ malIds, ...judgeGuess(groupIds, malIds) }));
  const found = guesses.flatMap((g) => (g.group === null ? [] : [g.group]));
  const mistakes = guesses.filter((g) => g.group === null).length;
  const solved = found.length === CONNECTIONS_GROUPS;
  const finished = solved || mistakes >= CONNECTIONS_MAX_MISTAKES;
  const shown = finished ? [...found, ...groupIds.map((_, tier) => tier).filter((tier) => !found.includes(tier))] : found;
  return {
    state: {
      id: puzzle.id,
      mode: 'connections',
      date: puzzle.date,
      pool: puzzle.pool,
      tiles,
      groups: shown.map((tier) => ({ tier, label: linkLabel(rows[tier]!.link), malIds: groupIds[tier]!, found: found.includes(tier) })),
      guesses,
      mistakes,
      maxMistakes: CONNECTIONS_MAX_MISTAKES,
      solved,
      finished,
      score: finished ? connectionsScore(solved, mistakes) : null,
    },
    groupIds,
  };
}

const storedGuesses = async (puzzleId: string, playerKey: string): Promise<number[][]> => {
  const play = await readPlay(puzzleId, playerKey);
  return play ? (JSON.parse(play.guesses) as number[][]) : [];
};

export async function connectionsState(puzzle: PuzzleRow, playerKey: string): Promise<ConnectionsState> {
  return (await evaluate(puzzle, await storedGuesses(puzzle.id, playerKey))).state;
}

/** One guess: CONNECTIONS_GROUP_SIZE titles of the board, none from a group already found, not tried before. */
export async function connectionsGuess(puzzle: PuzzleRow, playerKey: string, malIds: number[]): Promise<ConnectionsState> {
  const stored = await storedGuesses(puzzle.id, playerKey);
  const { state: before, groupIds } = await evaluate(puzzle, stored);
  if (before.finished) throw new HttpError(409, 'This puzzle is already finished.');
  if (malIds.length !== CONNECTIONS_GROUP_SIZE || new Set(malIds).size !== CONNECTIONS_GROUP_SIZE) throw new HttpError(400, `Pick ${CONNECTIONS_GROUP_SIZE} different titles.`);
  const open = new Set(groupIds.filter((_, tier) => !before.groups.some((g) => g.tier === tier)).flat());
  if (!malIds.every((id) => open.has(id))) throw new HttpError(400, 'Pick titles still on the board.');
  const key = [...malIds].sort((a, b) => a - b).join();
  if (stored.some((g) => [...g].sort((a, b) => a - b).join() === key)) throw new HttpError(409, 'You already tried those four.');

  const next = [...stored, malIds];
  const { state } = await evaluate(puzzle, next);
  await writePlay(puzzle.id, playerKey, { guesses: next, solved: state.groups.filter((g) => g.found).length, score: state.score, finished: state.finished });
  return state;
}
