import { isRoundMode, isSongMode } from '../../shared/modes.js';
import { viewer } from '../../server/accounts.js';
import { getPuzzle, swapRoundTitle } from '../../server/game.js';
import { HttpError, json, readJson, route } from '../../server/http.js';
import { puzzleState } from '../../server/puzzles.js';

/** { puzzleId, round }: the browser could not load a round's media; swap it (own unlimited puzzles, untouched rounds only). */
export const POST = route(async (req) => {
  const me = await viewer(req);
  const body = await readJson<{ puzzleId?: unknown; round?: unknown }>(req);
  if (typeof body.puzzleId !== 'string') throw new HttpError(400, 'puzzleId is required.');
  const puzzle = await getPuzzle(body.puzzleId);
  if (!isSongMode(puzzle.mode) && !isRoundMode(puzzle.mode)) throw new HttpError(400, 'Only Opening, Ending and Screenshot rounds can be replaced.');
  if (puzzle.date != null || puzzle.created_by !== me.key) throw new HttpError(403, 'Only rounds of your own unlimited puzzle can be replaced.');
  const round = Number(body.round);
  const state = await puzzleState(puzzle, me.key);
  const r = 'rounds' in state ? state.rounds[round] : undefined;
  const touched = !r || r.finished || ('clues' in r ? r.clues > 0 : 'clue' in r && r.clue.opened);
  if (touched) throw new HttpError(409, 'Only a round you have not played yet can be replaced.');
  await swapRoundTitle(puzzle, me.account, round);
  return json(await puzzleState(puzzle, me.key), {}, me.cookies);
});
