import { isBetaMode } from '../shared/modes.js';
import { viewer } from '../server/accounts.js';
import { dailyPuzzle, getPuzzle, parseDailyDate, parseDailyMode, parseDifficulties, parseMode, parsePool, poolSpec, unlimitedPuzzle, type PuzzleOptions } from '../server/game.js';
import { HttpError, json, readJson, route } from '../server/http.js';
import { parseLinkKinds } from '../server/connections.js';
import { BETA_PUZZLES, puzzleState } from '../server/puzzles.js';

/** ?mode=…[&date=YYYY-MM-DD] → that day's puzzle (today by default; earlier days replay the archive; beta modes have none). ?id=<uuid> → resume any puzzle. */
export const GET = route(async (req) => {
  const me = await viewer(req);
  const params = new URL(req.url).searchParams;
  const id = params.get('id');
  const puzzle = id ? await getPuzzle(id) : await dailyPuzzle(parseDailyMode(params.get('mode') ?? 'anidle'), parseDailyDate(params.get('date')));
  return json(await puzzleState(puzzle, me.key), {}, me.cookies);
});

/** New unlimited puzzle: { mode, pool, genreId?, difficulties?, links? (Connections' link kinds) }. Completed-list pools need a linked MAL account. */
export const POST = route(async (req) => {
  const me = await viewer(req);
  const body = await readJson<{ mode?: unknown; pool?: unknown; genreId?: unknown; difficulties?: unknown; links?: unknown }>(req);
  const genreId = body.genreId == null || body.genreId === '' ? undefined : Number(body.genreId);
  if (genreId !== undefined && !Number.isInteger(genreId)) throw new HttpError(400, 'genreId must be a number.');
  const mode = parseMode(body.mode ?? 'anidle');
  const options: PuzzleOptions = { genreId, difficulties: parseDifficulties(body.difficulties), links: mode === 'connections' ? parseLinkKinds(body.links) : undefined };
  const spec = poolSpec(parsePool(body.pool ?? 'semua'), me.account, mode, options);
  const puzzle = isBetaMode(mode) ? await BETA_PUZZLES[mode](spec, options, me.key) : await unlimitedPuzzle(mode, spec, options, me.key);
  return json(await puzzleState(puzzle, me.key), {}, me.cookies);
});
