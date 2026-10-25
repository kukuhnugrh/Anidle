import './env.js';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { db } from '../server/db.js';
import { requireEnv } from '../server/env.js';

export async function migrate(): Promise<void> {
  const url = requireEnv('TURSO_DATABASE_URL');
  // libsql creates the file but not its directory. Local URLs look like file:data/anidle.db.
  if (url.startsWith('file:')) mkdirSync(path.dirname(url.slice('file:'.length).split('?')[0]!), { recursive: true });
  await db().executeMultiple(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
}

if (import.meta.url === `file:///${process.argv[1]?.replace(/\\/g, '/')}`) {
  await migrate();
  console.log('Schema OK:', requireEnv('TURSO_DATABASE_URL').replace(/\?.*/, ''));
}
