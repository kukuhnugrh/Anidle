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
  // Character mode accepts romaji nicknames (MAL, step `nicknames`; details_at = when fetched) and
  // aliases (AniList alternative names without spoilers, step `aliases`).
  anime_character: { nicknames: "TEXT NOT NULL DEFAULT '[]'", details_at: 'TEXT', aliases: "TEXT NOT NULL DEFAULT '[]'" },
  // The franchise's most popular entry (pipeline step `franchise`); NULL until computed = itself.
  // synopsis: Anidle's second clue (MAL text; '' = MAL has none).
  // themes_at: when AnimeThemes was last asked for this entry's OP/ED (step `media`; NULL = never).
  // aliases_at: when AniList was last asked for this show's character aliases (step `aliases`; NULL = never).
  anime: { canonical_id: 'INTEGER', synopsis: 'TEXT', themes_at: 'TEXT', aliases_at: 'TEXT' },
  // A daily Opening/Ending round's full song copied to R2 by step `daily` (NULL = stream from AnimeThemes).
  // theme_id: the anime_theme a song-mode round plays (NULL for other modes).
  puzzle_round: { audio_key: 'TEXT', theme_id: 'INTEGER' },
  // The MAL user id the account is linked to: sign-in and linking match on it, never on the
  // username alone (MAL usernames can change hands).
  account: { mal_id: 'INTEGER' },
  // Seconds of an OP/ED video showing the anime's title, hidden in the clue (step `titles`, OCR): JSON
  // [[start, end], …]; NULL = not scanned yet. Dropped with the clip when the song's audio changes.
  anime_theme: { title_spans: 'TEXT' },
  // When a screenshot was read for the show's title (step `screenshots`); NULL = stored before that check.
  anime_screenshot: { checked_at: 'TEXT' },
};

/** Indexes on ADDED_COLUMNS, created once the columns exist. */
const ADDED_INDEXES = [
  'CREATE INDEX IF NOT EXISTS anime_canonical ON anime (canonical_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS account_mal_id ON account (mal_id)',
  // History, and moving guest plays on login, look plays up by player alone.
  'CREATE INDEX IF NOT EXISTS play_username ON play (username)',
];

/**
 * Accounts linked before account.mal_id existed take the id MAL reported at that link (player.mal_user_id,
 * written by the same OAuth callback). Only touches accounts still missing it.
 */
const BACKFILLS = [
  `UPDATE account SET mal_id = (SELECT p.mal_user_id FROM player p WHERE p.username = account.mal_username)
   WHERE mal_username IS NOT NULL AND mal_id IS NULL`,
];

export async function migrate(): Promise<void> {
  const url = requireEnv('TURSO_DATABASE_URL');
  // libsql creates the file but not its directory. Local URLs look like file:data/anidle.db.
  if (url.startsWith('file:')) mkdirSync(path.dirname(url.slice('file:'.length).split('?')[0]!), { recursive: true });
  await db().executeMultiple(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  for (const [table, columns] of Object.entries(ADDED_COLUMNS)) {
    const existing = new Set((await db().execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name)));
    for (const [column, type] of Object.entries(columns)) if (!existing.has(column)) await db().execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  for (const sql of ADDED_INDEXES) await db().execute(sql);
  for (const sql of BACKFILLS) await db().execute(sql);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrate();
  console.log('Schema OK:', requireEnv('TURSO_DATABASE_URL').replace(/\?.*/, ''));
}
