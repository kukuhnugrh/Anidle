import { characterEntries } from '../server/characters.js';
import { queryOf, revalidatedJson, route } from '../server/http.js';

// Character-name autocomplete list for Character mode (public: anonymous players need it too).
export const GET = route(async (req) => {
  queryOf(req);
  return revalidatedJson(req, await characterEntries());
});
