import { todayUtc7 } from '../shared/modes.js';
import { HttpError, json, route } from '../server/http.js';
import { leaderboard } from '../server/stats.js';

/** ?date=YYYY-MM-DD (default today, UTC+7): finished daily puzzles of every mode, accounts only. */
export const GET = route(async (req) => {
  const date = new URL(req.url).searchParams.get('date') ?? todayUtc7();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new HttpError(400, 'date must be YYYY-MM-DD.');
  return json(await leaderboard(date));
});
