import { titleEntries } from '../server/game.js';
import { queryOf, revalidatedJson, route } from '../server/http.js';

// Anime autocomplete list (public: anonymous players need it too).
export const GET = route(async (req) => {
  queryOf(req);
  return revalidatedJson(req, await titleEntries());
});
