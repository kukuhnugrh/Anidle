import { getPuzzle, submitGuess } from '../server/game.js';
import { HttpError, json, readJson, requireUser, route } from '../server/http.js';

export const POST = route(async (req) => {
  const username = requireUser(req);
  const body = await readJson<{ puzzleId?: unknown; malId?: unknown }>(req);
  const malId = Number(body.malId);
  if (typeof body.puzzleId !== 'string' || !Number.isInteger(malId)) throw new HttpError(400, 'Butuh puzzleId dan malId.');
  return json(await submitGuess(await getPuzzle(body.puzzleId), username, malId));
});
