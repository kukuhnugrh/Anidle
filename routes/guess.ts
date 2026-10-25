import { isThemeMode } from '../shared/modes.js';
import { viewer } from '../server/accounts.js';
import { anidleGuess, getPuzzle } from '../server/game.js';
import { HttpError, json, readJson, route } from '../server/http.js';
import { themeGuess } from '../server/themes.js';

/**
 * Anidle: { puzzleId, malId }. Song modes: { puzzleId, round, malId } or { puzzleId, round, skip: true }.
 */
export const POST = route(async (req) => {
  const me = await viewer(req);
  const body = await readJson<{ puzzleId?: unknown; malId?: unknown; round?: unknown; skip?: unknown }>(req);
  if (typeof body.puzzleId !== 'string') throw new HttpError(400, 'Butuh puzzleId.');
  const puzzle = await getPuzzle(body.puzzleId);
  const skip = body.skip === true;
  const malId = Number(body.malId);
  if (!skip && !Number.isInteger(malId)) throw new HttpError(400, 'Butuh malId.');

  if (!isThemeMode(puzzle.mode)) {
    if (skip) throw new HttpError(400, 'Anidle tidak punya skip.');
    return json(await anidleGuess(puzzle, me.key, malId), {}, me.cookies);
  }
  const round = Number(body.round);
  if (!Number.isInteger(round)) throw new HttpError(400, 'Butuh round.');
  return json(await themeGuess(puzzle, puzzle.mode, me.key, round, skip ? null : malId), {}, me.cookies);
});
