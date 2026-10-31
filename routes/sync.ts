import { requireAccount } from '../server/accounts.js';
import { HttpError, json, route } from '../server/http.js';
import { toHttpError } from '../server/mal.js';
import { syncCompleted, syncWait } from '../server/players.js';

// Re-reads the linked MAL account's completed list. Titles new to the database wait in enrich_queue for the next pipeline run.
export const POST = route(async (req) => {
  const account = await requireAccount(req);
  if (!account.malUsername) throw new HttpError(403, 'Link your MAL account first.');
  const wait = await syncWait(account.malUsername);
  if (wait > 0) throw new HttpError(429, `Synced a moment ago. Try again in ${Math.ceil(wait / 60_000)} min.`);
  try {
    return json(await syncCompleted(account.malUsername));
  } catch (err) {
    throw toHttpError(err);
  }
});
