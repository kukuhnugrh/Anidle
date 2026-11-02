import { catalogListUrls } from '../server/catalog.js';
import { json, queryOf, route } from '../server/http.js';

// Where the catalog lists (autocomplete, Database facets) are on R2 right now (public: anonymous players
// need them too). Their keys change with their content, and the previous ones stay until the next
// pipeline rebuild, so a cached answer still points at files that exist.
export const GET = route(async (req) => {
  queryOf(req);
  return json(await catalogListUrls(), { headers: { 'cache-control': 'public, s-maxage=300, max-age=60' } });
});
