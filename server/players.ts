import { accountById, registerFromMal, type Account } from './accounts.js';
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

/**
 * Another account still holding this MAL username but bound to a different MAL user: that user renamed
 * and the name now belongs to `me`. Their link is dropped (their mal_id stays, so signing in with MAL
 * finds the account again and takes their new name). A legacy link with no MAL id cannot be checked.
 */
async function releaseStaleName(me: MalMe, selfId?: number): Promise<void> {
  const holder = await one<{ id: number; mal_id: number | null }>('SELECT id, mal_id FROM account WHERE mal_username = ?', [me.name]);
  if (!holder || Number(holder.id) === selfId || Number(holder.mal_id) === me.id) return;
  if (holder.mal_id == null) throw new HttpError(409, `MAL account ${me.name} is already linked to another account.`);
  await run('UPDATE account SET mal_username = NULL WHERE id = ?', [holder.id]);
}

/** Links a MAL account (after OAuth) to a web account. One MAL user (by id) belongs to one web account. */
export async function linkMal(account: Account, me: MalMe, tokens: MalTokens): Promise<void> {
  const owner = await one<{ id: number }>('SELECT id FROM account WHERE mal_id = ? AND id != ?', [me.id, account.id]);
  if (owner) throw new HttpError(409, `MAL account ${me.name} is already linked to another account.`);
  await releaseStaleName(me, account.id);
  await savePlayer(me, tokens);
  await run('UPDATE account SET mal_username = ?, mal_id = ? WHERE id = ?', [me.name, me.id, account.id]);
}

/**
 * Signing in with MAL: the web account linked to this MAL user, or a new password-less one linked to it.
 * Matched on the MAL user id, never the username: a MAL username freed by a rename and taken by someone
 * else must not open the old owner's account. A renamed owner's account follows the new name.
 */
export async function signInWithMal(me: MalMe, tokens: MalTokens): Promise<Account> {
  const linked = await one<{ id: number }>('SELECT id FROM account WHERE mal_id = ?', [me.id]);
  const existing = linked ? await accountById(Number(linked.id)) : null;
  if (existing) {
    if (existing.malUsername?.toLowerCase() !== me.name.toLowerCase()) {
      await releaseStaleName(me, existing.id);
      await run('UPDATE account SET mal_username = ? WHERE id = ?', [me.name, existing.id]);
    }
    await savePlayer(me, tokens);
    return { ...existing, malUsername: me.name };
  }
  await releaseStaleName(me);
  const account = await registerFromMal(me.name);
  await linkMal(account, me, tokens);
  return { ...account, malUsername: me.name };
}

/**
 * Forgets the link and the stored MAL tokens. The completed list stays only when it is part of the
 * shared pool (POOL_USERS), where the pipeline keeps it up to date from the public list.
 */
export async function unlinkMal(account: Account): Promise<void> {
  if (!account.malUsername) return;
  if (!account.hasPassword) throw new HttpError(409, 'This account signs in with MAL only, so MAL cannot be unlinked.');
  const shared = isPoolUser(account.malUsername);
  await db().batch(
    [
      { sql: 'UPDATE account SET mal_username = NULL, mal_id = NULL WHERE id = ?', args: [account.id] },
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

/** Each sync rewrites the whole completed list in Turso, so a player can ask for one this often. */
export const SYNC_COOLDOWN_MS = 10 * 60_000;

/** Milliseconds until this player may sync again (0 = now). */
export async function syncWait(username: string): Promise<number> {
  const row = await one<{ last_sync_at: string | null }>('SELECT last_sync_at FROM player WHERE username = ?', [username]);
  const last = row?.last_sync_at ? Date.parse(row.last_sync_at) : NaN;
  return Number.isNaN(last) ? 0 : Math.max(0, last + SYNC_COOLDOWN_MS - Date.now());
}

export interface SyncResult {
  username: string;
  completed: number;
  /** Titles that are now in the pool but have no anime row yet (queued for the pipeline). */
  queued: number;
  via: 'token' | 'public';
}

/** A shared-pool list (POOL_USERS): only these feed the catalog (enrich_queue) and survive an unlink. */
const isPoolUser = (username: string) => poolUsers().some((u) => u.toLowerCase() === username.toLowerCase());

/**
 * Brings a player's stored completed list in line with MAL. Uses their own token when they logged in
 * (works for private lists), otherwise the public list via Client ID. Only the difference is written
 * (Turso bills rows written), and only shared-pool lists queue unknown titles for the pipeline: another
 * player's `saya` pool uses the titles already in the catalog, so nobody can grow it with their list.
 */
export async function syncCompleted(username: string, schedule?: <T>(task: () => Promise<T>) => Promise<T>): Promise<SyncResult> {
  const token = await userAccessToken(username);
  const auth: MalAuth = token ? { kind: 'user', accessToken: token } : { kind: 'client' };
  const ids = await completedIds(token ? '@me' : username, auth, schedule);

  const fresh = new Set(ids);
  const stored = new Set((await all<{ mal_id: number }>('SELECT mal_id FROM completed WHERE username = ?', [username])).map((r) => Number(r.mal_id)));
  const now = nowIso();
  const shared = isPoolUser(username);
  const statements = [
    ...[...stored].filter((id) => !fresh.has(id)).map((id) => ({ sql: 'DELETE FROM completed WHERE username = ? AND mal_id = ?', args: [username, id] })),
    ...ids.filter((id) => !stored.has(id)).map((id) => ({ sql: 'INSERT OR IGNORE INTO completed (username, mal_id) VALUES (?, ?)', args: [username, id] })),
    ...(shared
      ? [
          {
            sql: `INSERT OR IGNORE INTO enrich_queue (mal_id, reason, added_at)
                  SELECT c.mal_id, 'completed:' || c.username, ? FROM completed c
                  WHERE c.username = ? AND NOT EXISTS (SELECT 1 FROM anime a WHERE a.mal_id = c.mal_id)`,
            args: [now, username],
          },
        ]
      : []),
    { sql: 'UPDATE player SET last_sync_at = ? WHERE username = ?', args: [now, username] },
  ];
  await db().batch(statements, 'write');
  const queued = shared
    ? await all<{ n: number }>(`SELECT COUNT(*) AS n FROM enrich_queue q JOIN completed c ON c.mal_id = q.mal_id WHERE c.username = ?`, [username])
    : [];
  return { username, completed: ids.length, queued: Number(queued[0]?.n ?? 0), via: token ? 'token' : 'public' };
}
