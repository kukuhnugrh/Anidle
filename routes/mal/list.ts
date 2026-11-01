import { requireAccount } from '../../server/accounts.js';
import { HttpError, json, queryOf, route } from '../../server/http.js';
import { malList } from '../../server/mallist.js';

/** The signed-in player's whole MAL anime list (every status), read live from MAL. ?fresh=1 skips the short reuse. */
export const GET = route(async (req) => {
  const fresh = queryOf(req, ['fresh']).get('fresh') === '1';
  const account = await requireAccount(req);
  if (!account.malUsername) throw new HttpError(403, 'Link your MAL account to see your list.');
  // Private to this player: never kept by the CDN.
  return json(await malList(account.malUsername, fresh));
});
