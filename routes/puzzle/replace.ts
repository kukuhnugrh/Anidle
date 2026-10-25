import { isThemeMode } from '../../shared/modes.js';
import { viewer } from '../../server/accounts.js';
import { getPuzzle } from '../../server/game.js';
import { HttpError, json, readJson, route } from '../../server/http.js';
import { replaceRound } from '../../server/themes.js';

/** { puzzleId, round }: the browser could not load a round's audio; swap it (own unlimited puzzles only). */
export const POST = route(async (req) => {
  const me = await viewer(req);
  const body = await readJson<{ puzzleId?: unknown; round?: unknown }>(req);
  if (typeof body.puzzleId !== 'string') throw new HttpError(400, 'Butuh puzzleId.');
  const puzzle = await getPuzzle(body.puzzleId);
  if (!isThemeMode(puzzle.mode)) throw new HttpError(400, 'Hanya mode Opening/Ending yang punya ronde.');
  return json(await replaceRound(puzzle, puzzle.mode, me.key, me.account, Number(body.round)), {}, me.cookies);
});
