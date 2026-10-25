import { one } from '../server/db.js';
import { isAllowed } from '../server/env.js';
import { json, route, sessionUser } from '../server/http.js';

export const GET = route(async (req) => {
  const username = sessionUser(req);
  if (!username) return json({ user: null });
  // The pipeline can sync a public list before the player ever logs in, so `completed` stands on its own.
  const row = await one<{ avatar: string | null; last_sync_at: string | null; completed: number }>(
    `SELECT (SELECT avatar FROM player WHERE username = ?1) AS avatar,
            (SELECT last_sync_at FROM player WHERE username = ?1) AS last_sync_at,
            (SELECT COUNT(*) FROM completed WHERE username = ?1) AS completed`,
    [username],
  );
  return json({
    user: {
      username,
      avatar: row?.avatar ?? null,
      lastSyncAt: row?.last_sync_at ?? null,
      completed: Number(row?.completed ?? 0),
      allowed: isAllowed(username),
    },
  });
});
