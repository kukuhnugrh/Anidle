import { viewer } from '../server/accounts.js';
import { json, route } from '../server/http.js';
import { history } from '../server/stats.js';

/** The viewer's finished puzzles and per-mode daily stats (account, or this browser when anonymous). */
export const GET = route(async (req) => {
  const me = await viewer(req);
  return json(await history(me.key), {}, me.cookies);
});
