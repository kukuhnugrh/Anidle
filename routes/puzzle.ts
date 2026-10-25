import { viewer } from '../server/accounts.js';
import { dailyPuzzle, getPuzzle, parseDifficulties, parseMode, parsePool, poolSpec, unlimitedPuzzle, type PuzzleOptions } from '../server/game.js';
import { HttpError, json, readJson, route } from '../server/http.js';
import { puzzleState } from '../server/puzzles.js';

/** ?mode=anidle|opening|ending → today's puzzle. ?id=<uuid> → resume any puzzle (e.g. an unlimited one after reload). */
export const GET = route(async (req) => {
  const me = await viewer(req);
  const params = new URL(req.url).searchParams;
  const id = params.get('id');
  const puzzle = id ? await getPuzzle(id) : await dailyPuzzle(parseMode(params.get('mode') ?? 'anidle'));
  return json(await puzzleState(puzzle, me.key), {}, me.cookies);
});

/** New unlimited puzzle: { mode, pool, genreId?, difficulties? }. Completed-list pools need a linked MAL account. */
export const POST = route(async (req) => {
  const me = await viewer(req);
  const body = await readJson<{ mode?: unknown; pool?: unknown; genreId?: unknown; difficulties?: unknown }>(req);
  const genreId = body.genreId == null || body.genreId === '' ? undefined : Number(body.genreId);
  if (genreId !== undefined && !Number.isInteger(genreId)) throw new HttpError(400, 'genreId harus angka.');
  const mode = parseMode(body.mode ?? 'anidle');
  const options: PuzzleOptions = { genreId, difficulties: parseDifficulties(body.difficulties) };
  const puzzle = await unlimitedPuzzle(mode, poolSpec(parsePool(body.pool ?? 'semua'), me.account, mode, options), options, me.key);
  return json(await puzzleState(puzzle, me.key), {}, me.cookies);
});
