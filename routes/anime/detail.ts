import { animeDetail } from '../../server/database.js';
import { HttpError, json, queryOf, route } from '../../server/http.js';

/** One show with everything the game uses for it: ?id=<mal_id> (any of its entries). */
export const GET = route(async (req) => {
  const id = Number(queryOf(req, ['id']).get('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id.');
  const detail = await animeDetail(id);
  if (!detail) throw new HttpError(404, 'That title is not in the database.');
  // Same for everyone and only changes with the pipeline: the CDN keeps it briefly (purged on every
  // deploy). Browsers revalidate each time, so a cached response from an older deploy never meets new UI code.
  return json(detail, { headers: { 'cache-control': 'public, s-maxage=300, max-age=0' } });
});
