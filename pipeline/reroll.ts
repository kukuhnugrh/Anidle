import './env.js';
import { all, db } from '../server/db.js';
import { requireEnv } from '../server/env.js';
import { DAILY_MODES, todayUtc7, type DailyMode } from '../shared/modes.js';
import { deleteObject } from './r2.js';

/**
 * Throws away a date's daily puzzles (with everyone's plays on them) and has them drawn again on the
 * next request, with a new seed (daily_reroll). Usage:
 *   npm run daily:reroll -- [--date=YYYY-MM-DD] [--mode=anidle,opening] [--turso]
 * Defaults: today (UTC+7), every daily mode.
 */
const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const date = arg('date') ?? todayUtc7();
const requested = arg('mode')?.split(',') ?? [...DAILY_MODES];
const modes = requested.filter((m): m is DailyMode => DAILY_MODES.some((known) => known === m));
if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || modes.length !== requested.length || !modes.length) {
  console.error(`Pakai: --date=YYYY-MM-DD --mode=${DAILY_MODES.join(',')}`);
  process.exit(1);
}

const puzzles = await all<{ id: string; mode: DailyMode }>(`SELECT id, mode FROM puzzle WHERE date = ? AND mode IN (${modes.map(() => '?').join(',')})`, [date, ...modes]);
const plays = await all<{ n: number }>(
  `SELECT COUNT(*) AS n FROM play WHERE puzzle_id IN (SELECT id FROM puzzle WHERE date = ? AND mode IN (${modes.map(() => '?').join(',')}))`,
  [date, ...modes],
);
// R2 copies of the songs (step `daily`) go too, unless another round still uses the same file.
const songKeys = puzzles.length
  ? await all<{ audio_key: string }>(
      `SELECT DISTINCT audio_key FROM puzzle_round WHERE audio_key IS NOT NULL AND puzzle_id IN (${puzzles.map(() => '?').join(',')})`,
      puzzles.map((p) => p.id),
    )
  : [];
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
for (const { audio_key } of songKeys) if (!(await all('SELECT 1 FROM puzzle_round WHERE audio_key = ? LIMIT 1', [audio_key])).length) await deleteObject(audio_key);
console.log(
  `${requireEnv('TURSO_DATABASE_URL').replace(/\?.*/, '')}: ${date} di-reroll (${puzzles.map((p) => p.mode).join(', ') || 'belum ada puzzle'}; ${Number(plays[0]?.n ?? 0)} play, ${songKeys.length} salinan lagu dihapus)`,
);
