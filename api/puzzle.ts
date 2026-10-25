import { viewer } from '../server/accounts.js';
import { dailyPuzzle, getPuzzle, MODES, parsePool, poolSpec, puzzleState, unlimitedPuzzle, type Mode } from '../server/game.js';
import { HttpError, json, readJson, route } from '../server/http.js';

function parseMode(value: unknown): Mode {
  if (typeof value === 'string' && (MODES as readonly string[]).includes(value)) return value as Mode;
  throw new HttpError(400, `Mode tidak dikenal: ${String(value)}`);
}

/** ?mode=anidle → today's puzzle. ?id=<uuid> → resume any puzzle (e.g. an unlimited one after reload). */
export const GET = route(async (req) => {
  const me = await viewer(req);
  const params = new URL(req.url).searchParams;
  const id = params.get('id');
  const puzzle = id ? await getPuzzle(id) : await dailyPuzzle(parseMode(params.get('mode') ?? 'anidle'));
  return json(await puzzleState(puzzle, me.key), {}, me.cookies);
});

/** New unlimited puzzle: { mode, pool, genreId? }. Completed-list pools need a linked MAL account. */
export const POST = route(async (req) => {
  const me = await viewer(req);
  const body = await readJson<{ mode?: unknown; pool?: unknown; genreId?: unknown }>(req);
  const genreId = body.genreId == null || body.genreId === '' ? undefined : Number(body.genreId);
  if (genreId !== undefined && !Number.isInteger(genreId)) throw new HttpError(400, 'genreId harus angka.');
  const spec = poolSpec(parsePool(body.pool ?? 'semua'), me.account, genreId);
  const puzzle = await unlimitedPuzzle(parseMode(body.mode ?? 'anidle'), spec, me.key);
  return json(await puzzleState(puzzle, me.key), {}, me.cookies);
});
