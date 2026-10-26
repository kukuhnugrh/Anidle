import './env.js';
import { all, db } from '../server/db.js';
import { requireEnv } from '../server/env.js';
import { MODES, todayWib, type Mode } from '../shared/modes.js';

/**
 * Throws away a date's daily puzzles (with everyone's plays on them) and has them drawn again on the
 * next request, with a new seed (daily_reroll). Usage:
 *   npm run daily:reroll -- [--date=YYYY-MM-DD] [--mode=anidle,opening] [--turso]
 * Defaults: today (WIB), every mode.
 */
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const date = arg('date') ?? todayWib();
const requested = arg('mode')?.split(',') ?? [...MODES];
const modes = requested.filter((m): m is Mode => MODES.some((known) => known === m));
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || modes.length !== requested.length || !modes.length) {
  console.error(`Pakai: --date=YYYY-MM-DD --mode=${MODES.join(',')}`);
  process.exit(1);
}

const puzzles = await all<{ id: string; mode: Mode }>(`SELECT id, mode FROM puzzle WHERE date = ? AND mode IN (${modes.map(() => '?').join(',')})`, [date, ...modes]);
const plays = await all<{ n: number }>(
  `SELECT COUNT(*) AS n FROM play WHERE puzzle_id IN (SELECT id FROM puzzle WHERE date = ? AND mode IN (${modes.map(() => '?').join(',')}))`,
  [date, ...modes],
);
await db().batch(
  [
    ...puzzles.flatMap(({ id }) => [
      { sql: 'DELETE FROM play WHERE puzzle_id = ?', args: [id] },
      { sql: 'DELETE FROM puzzle_round WHERE puzzle_id = ?', args: [id] },
      { sql: 'DELETE FROM puzzle_character WHERE puzzle_id = ?', args: [id] },
      { sql: 'DELETE FROM puzzle WHERE id = ?', args: [id] },
    ]),
    { sql: 'INSERT INTO daily_reroll (date, n) VALUES (?, 1) ON CONFLICT (date) DO UPDATE SET n = n + 1', args: [date] },
  ],
  'write',
);
console.log(`${requireEnv('TURSO_DATABASE_URL').replace(/\?.*/, '')}: ${date} di-reroll (${puzzles.map((p) => p.mode).join(', ') || 'belum ada puzzle'}; ${Number(plays[0]?.n ?? 0)} play dihapus)`);
