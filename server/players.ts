import type { Account } from './accounts.js';
import { decrypt, encrypt } from './crypto.js';
import { all, db, nowIso, one, run } from './db.js';
import { poolUsers } from './env.js';
import { HttpError } from './http.js';
import { completedIds, refreshTokens, type MalAuth, type MalMe, type MalTokens } from './mal.js';

const REFRESH_MARGIN_MS = 5 * 60 * 1000;

interface PlayerRow {
  username: string;
  refresh_token_enc: string | null;
  access_token_enc: string | null;
  token_expires_at: number | null;
}

export async function savePlayer(me: MalMe, tokens: MalTokens): Promise<void> {
  await run(
    `INSERT INTO player (username, mal_user_id, avatar, access_token_enc, refresh_token_enc, token_expires_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (username) DO UPDATE SET
       mal_user_id = excluded.mal_user_id, avatar = excluded.avatar, access_token_enc = excluded.access_token_enc,
       refresh_token_enc = excluded.refresh_token_enc, token_expires_at = excluded.token_expires_at`,
    [me.name, me.id, me.picture ?? null, encrypt(tokens.accessToken), encrypt(tokens.refreshToken), tokens.expiresAt, nowIso()],
  );
}

/** Links a MAL account (after OAuth) to a web account. One MAL account belongs to one web account. */
export async function linkMal(account: Account, me: MalMe, tokens: MalTokens): Promise<void> {
  const owner = await one<{ id: number }>('SELECT id FROM account WHERE mal_username = ? AND id != ?', [me.name, account.id]);
  if (owner) throw new HttpError(409, `MAL account ${me.name} is already linked to another account.`);
  await savePlayer(me, tokens);
  await run('UPDATE account SET mal_username = ? WHERE id = ?', [me.name, account.id]);
}

/**
 * Forgets the link and the stored MAL tokens. The completed list stays only when it is part of the
 * shared pool (POOL_USERS), where the pipeline keeps it up to date from the public list.
 */
export async function unlinkMal(account: Account): Promise<void> {
  if (!account.malUsername) return;
  const shared = poolUsers().some((u) => u.toLowerCase() === account.malUsername!.toLowerCase());
  await db().batch(
    [
      { sql: 'UPDATE account SET mal_username = NULL WHERE id = ?', args: [account.id] },
      { sql: 'UPDATE player SET access_token_enc = NULL, refresh_token_enc = NULL, token_expires_at = NULL WHERE username = ?', args: [account.malUsername] },
      ...(shared ? [] : [{ sql: 'DELETE FROM completed WHERE username = ?', args: [account.malUsername] }]),
    ],
    'write',
  );
}

/** A valid access token for a player who logged in at least once, refreshed (and persisted) when close to expiry. */
export async function userAccessToken(username: string): Promise<string | null> {
  const row = await one<PlayerRow>('SELECT username, refresh_token_enc, access_token_enc, token_expires_at FROM player WHERE username = ?', [username]);
  if (!row?.refresh_token_enc || !row.access_token_enc) return null;
  if ((row.token_expires_at ?? 0) - REFRESH_MARGIN_MS > Date.now()) return decrypt(row.access_token_enc);
  const tokens = await refreshTokens(decrypt(row.refresh_token_enc));
  await run('UPDATE player SET access_token_enc = ?, refresh_token_enc = ?, token_expires_at = ? WHERE username = ?', [
    encrypt(tokens.accessToken),
    encrypt(tokens.refreshToken),
    tokens.expiresAt,
    row.username,
  ]);
  return tokens.accessToken;
}

export interface SyncResult {
  username: string;
  completed: number;
  /** Titles that are now in the pool but have no anime row yet (queued for the pipeline). */
  queued: number;
  via: 'token' | 'public';
}

/**
 * Replaces a player's completed list. Uses their own token when they logged in (works for private
 * lists), otherwise the public list via Client ID.
 */
export async function syncCompleted(username: string, schedule?: <T>(task: () => Promise<T>) => Promise<T>): Promise<SyncResult> {
  const token = await userAccessToken(username);
  const auth: MalAuth = token ? { kind: 'user', accessToken: token } : { kind: 'client' };
  const ids = await completedIds(token ? '@me' : username, auth, schedule);

  const now = nowIso();
  const statements = [
    { sql: 'DELETE FROM completed WHERE username = ?', args: [username] },
    ...ids.map((id) => ({ sql: 'INSERT OR IGNORE INTO completed (username, mal_id) VALUES (?, ?)', args: [username, id] })),
    {
      sql: `INSERT OR IGNORE INTO enrich_queue (mal_id, reason, added_at)
            SELECT c.mal_id, 'completed:' || c.username, ? FROM completed c
            WHERE c.username = ? AND NOT EXISTS (SELECT 1 FROM anime a WHERE a.mal_id = c.mal_id)`,
      args: [now, username],
    },
    { sql: 'UPDATE player SET last_sync_at = ? WHERE username = ?', args: [now, username] },
  ];
  await db().batch(statements, 'write');
  const queued = await all<{ n: number }>(
    `SELECT COUNT(*) AS n FROM enrich_queue q JOIN completed c ON c.mal_id = q.mal_id WHERE c.username = ?`,
    [username],
  );
  return { username, completed: ids.length, queued: Number(queued[0]?.n ?? 0), via: token ? 'token' : 'public' };
}
