import { one } from '../server/db.js';
import { json, route } from '../server/http.js';

export const GET = route(async () => {
  const counts = await one<{ anime: number; players: number }>(
    'SELECT (SELECT COUNT(*) FROM anime WHERE excluded IS NULL) AS anime, (SELECT COUNT(DISTINCT username) FROM completed) AS players',
  );
  return json({ ok: true, anime: Number(counts?.anime ?? 0), players: Number(counts?.players ?? 0) });
});
