import { titleEntries } from '../server/game.js';
import { revalidatedJson, route } from '../server/http.js';

// Anime autocomplete list (public: anonymous players need it too).
export const GET = route(async (req) => revalidatedJson(req, await titleEntries()));
