import { createHash } from 'node:crypto';
import { titleEntries } from '../server/game.js';
import { requireUser, route } from '../server/http.js';

// Autocomplete list. ETag lets the browser revalidate cheaply; a new pipeline run changes it.
export const GET = route(async (req) => {
  requireUser(req);
  const body = JSON.stringify(await titleEntries());
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 16)}"`;
  const headers = { etag, 'cache-control': 'private, no-cache' };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });
});
