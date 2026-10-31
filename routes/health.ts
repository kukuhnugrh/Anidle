import { one } from '../server/db.js';
import { json, queryOf, route } from '../server/http.js';
import { memo } from '../server/memo.js';

// Both counts scan whole tables (Turso bills every row), so they come from memory and the CDN.
export const GET = route(async (req) => {
  queryOf(req);
  const counts = await memo('health', 10 * 60_000, () =>
    one<{ anime: number; players: number }>(
      'SELECT (SELECT COUNT(*) FROM anime WHERE excluded IS NULL) AS anime, (SELECT COUNT(DISTINCT username) FROM completed) AS players',
    ),
  );
  return json({ ok: true, anime: Number(counts?.anime ?? 0), players: Number(counts?.players ?? 0) }, { headers: { 'cache-control': 'public, s-maxage=600' } });
});
