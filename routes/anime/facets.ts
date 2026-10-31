import { facets } from '../../server/database.js';
import { json, queryOf, route } from '../../server/http.js';

export const GET = route(async (req) => {
  queryOf(req);
  return json(await facets(), { headers: { 'cache-control': 'public, s-maxage=3600, max-age=600' } });
});
