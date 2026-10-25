import './env.js';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { db } from '../server/db.js';
import { requireEnv } from '../server/env.js';

/**
 * Columns added after a table first shipped. SQLite has no ADD COLUMN IF NOT EXISTS, so they are
 * added here when PRAGMA table_info does not list them yet (schema.sql stays re-runnable).
 */
const ADDED_COLUMNS: Record<string, Record<string, string>> = {
  // JSON { genreId?, difficulties? }: the filters an unlimited puzzle was made with, for replacing a round.
  puzzle: { options: 'TEXT' },
  // Character mode accepts nicknames and the kanji name; details_at = when they were fetched.
  anime_character: { nicknames: "TEXT NOT NULL DEFAULT '[]'", name_kanji: 'TEXT', details_at: 'TEXT' },
};

export async function migrate(): Promise<void> {
  const url = requireEnv('TURSO_DATABASE_URL');
  // libsql creates the file but not its directory. Local URLs look like file:data/anidle.db.
  if (url.startsWith('file:')) mkdirSync(path.dirname(url.slice('file:'.length).split('?')[0]!), { recursive: true });
  await db().executeMultiple(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const existing = new Set((await db().execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name)));
    for (const [column, type] of Object.entries(columns)) if (!existing.has(column)) await db().execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrate();
  console.log('Schema OK:', requireEnv('TURSO_DATABASE_URL').replace(/\?.*/, ''));
}
