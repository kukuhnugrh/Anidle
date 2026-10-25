import { json, requireUser, route } from '../server/http.js';
import { toHttpError } from '../server/mal.js';
import { syncCompleted } from '../server/players.js';

// Re-reads the player's completed list. Titles new to the pool wait in enrich_queue for the next pipeline run.
export const POST = route(async (req) => {
  const username = requireUser(req);
  try {
    return json(await syncCompleted(username));
  } catch (err) {
    throw toHttpError(err);
  }
});
