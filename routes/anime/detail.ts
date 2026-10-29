import { animeDetail } from '../../server/database.js';
import { HttpError, json, route } from '../../server/http.js';

/** One show with everything the game uses for it: ?id=<mal_id> (any of its entries). */
export const GET = route(async (req) => {
  const id = Number(new URL(req.url).searchParams.get('id'));
  if (!Number.isInteger(id) || id <= 0) throw new HttpError(400, 'Invalid id.');
  const detail = await animeDetail(id);
  if (!detail) throw new HttpError(404, 'That title is not in the database.');
  // Same for everyone and only changes with the pipeline: let the CDN keep it briefly.
  return json(detail, { headers: { 'cache-control': 'public, s-maxage=300, max-age=60' } });
});
