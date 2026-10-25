import { createClient, type Client, type InValue } from '@libsql/client';
import { optionalEnv, requireEnv } from './env.js';

let client: Client | undefined;

/** Turso in production, a local SQLite file (`file:data/anidle.db`) in development. Same client either way. */
export function db(): Client {
  client ??= createClient({
    url: requireEnv('TURSO_DATABASE_URL'),
    authToken: optionalEnv('TURSO_AUTH_TOKEN') || undefined,
  });
  return client;
}

export async function all<T>(sql: string, args: InValue[] = []): Promise<T[]> {
  const result = await db().execute({ sql, args });
  return result.rows as unknown as T[];
}

export async function one<T>(sql: string, args: InValue[] = []): Promise<T | undefined> {
  return (await all<T>(sql, args))[0];
}

export async function run(sql: string, args: InValue[] = []): Promise<number> {
  return (await db().execute({ sql, args })).rowsAffected;
}

export const nowIso = () => new Date().toISOString();
