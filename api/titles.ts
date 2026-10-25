import { createHash } from 'node:crypto';
import { titleEntries } from '../server/game.js';
import { route } from '../server/http.js';

// Autocomplete list (public: anonymous players need it too). ETag lets the browser revalidate cheaply.
export const GET = route(async (req) => {
  const body = JSON.stringify(await titleEntries());
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 16)}"`;
  const headers = { etag, 'cache-control': 'public, no-cache' };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });
});
