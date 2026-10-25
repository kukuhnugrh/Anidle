import { isRoundMode } from '../../shared/modes.js';
import { viewer } from '../../server/accounts.js';
import { getPuzzle } from '../../server/game.js';
import { HttpError, json, readJson, route } from '../../server/http.js';
import { replaceRound } from '../../server/rounds.js';

/** { puzzleId, round }: the browser could not load a round's media; swap it (own unlimited puzzles only). */
export const POST = route(async (req) => {
  const me = await viewer(req);
  const body = await readJson<{ puzzleId?: unknown; round?: unknown }>(req);
  if (typeof body.puzzleId !== 'string') throw new HttpError(400, 'puzzleId is required.');
  const puzzle = await getPuzzle(body.puzzleId);
  if (!isRoundMode(puzzle.mode)) throw new HttpError(400, 'Only Opening, Ending and Screenshot rounds can be replaced.');
  return json(await replaceRound(puzzle, puzzle.mode, me.key, me.account, Number(body.round)), {}, me.cookies);
});
