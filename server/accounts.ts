import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';
import { sign, verify } from './crypto.js';
import { db, nowIso, one, run } from './db.js';
import { getCookie, HttpError, setCookie } from './http.js';

const scrypt = promisify<string, Buffer, number, ScryptOptions, Buffer>(scryptCb);
const SCRYPT = { N: 16_384, r: 8, p: 1 } as const;
const KEY_LEN = 32;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEY_LEN, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scrypt(password, Buffer.from(salt, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}

// A real hash of a throwaway password, so a login for an unknown username costs the same as a wrong password.
const dummyHash = hashPassword(randomBytes(12).toString('hex'));

export const USERNAME_RULE = /^[A-Za-z0-9_]{3,20}$/;
export const PASSWORD_MIN = 8;

export interface Account {
  id: number;
  username: string;
  malUsername: string | null;
  /** False for accounts made by signing in with MAL: MAL is their only way in. */
  hasPassword: boolean;
}

interface AccountRow {
  id: number;
  username: string;
  password_hash: string;
  mal_username: string | null;
}

// Accounts made through MAL store an empty hash, which never verifies.
const toAccount = (row: AccountRow): Account => ({ id: Number(row.id), username: row.username, malUsername: row.mal_username, hasPassword: row.password_hash !== '' });

export async function register(username: string, password: string): Promise<Account> {
  if (!USERNAME_RULE.test(username)) throw new HttpError(400, 'Username must be 3–20 characters: letters, numbers, or _.');
  if (password.length < PASSWORD_MIN || password.length > 200) throw new HttpError(400, `Password must be at least ${PASSWORD_MIN} characters.`);
  const hash = await hashPassword(password);
  const inserted = await run('INSERT OR IGNORE INTO account (username, password_hash, created_at) VALUES (?, ?, ?)', [username, hash, nowIso()]);
  if (!inserted) throw new HttpError(409, `Username ${username} is already taken.`);
  return toAccount((await one<AccountRow>('SELECT * FROM account WHERE username = ?', [username]))!);
}

/** A password-less account for someone signing in with MAL, named after the MAL name (made unique when taken). */
export async function registerFromMal(malName: string): Promise<Account> {
  const base = malName.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 20).padEnd(3, '_');
  for (let attempt = 0; attempt < 20; attempt++) {
    const username = attempt === 0 ? base : `${base.slice(0, 15)}_${randomBytes(2).toString('hex')}`;
    const inserted = await run("INSERT OR IGNORE INTO account (username, password_hash, created_at) VALUES (?, '', ?)", [username, nowIso()]);
    if (inserted) return toAccount((await one<AccountRow>('SELECT * FROM account WHERE username = ?', [username]))!);
  }
  throw new HttpError(409, `Could not pick a free username for ${malName}.`);
}

export async function login(username: string, password: string): Promise<Account> {
  const row = await one<AccountRow>('SELECT * FROM account WHERE username = ?', [username]);
  const ok = await verifyPassword(password, row?.password_hash ?? (await dummyHash));
  if (!row || !ok) throw new HttpError(401, 'Wrong username or password.');
  return toAccount(row);
}

export async function accountById(id: number): Promise<Account | null> {
  const row = await one<AccountRow>('SELECT * FROM account WHERE id = ?', [id]);
  return row ? toAccount(row) : null;
}

export interface AccountView {
  username: string;
  hasPassword: boolean;
  mal: { username: string; avatar: string | null; completed: number; lastSyncAt: string | null } | null;
}

/** What the browser may know about an account (never the hash or tokens). */
export async function describeAccount(account: Account): Promise<AccountView> {
  if (!account.malUsername) return { username: account.username, hasPassword: account.hasPassword, mal: null };
  const row = await one<{ avatar: string | null; last_sync_at: string | null; completed: number }>(
    `SELECT (SELECT avatar FROM player WHERE username = ?1) AS avatar,
            (SELECT last_sync_at FROM player WHERE username = ?1) AS last_sync_at,
            (SELECT COUNT(*) FROM completed WHERE username = ?1) AS completed`,
    [account.malUsername],
  );
  return {
    username: account.username,
    hasPassword: account.hasPassword,
    mal: { username: account.malUsername, avatar: row?.avatar ?? null, completed: Number(row?.completed ?? 0), lastSyncAt: row?.last_sync_at ?? null },
  };
}

// ------------------------------------------------------------------ session & identity

const SESSION_COOKIE = 'anidle_session';
const SESSION_DAYS = 30;
const ANON_COOKIE = 'anidle_anon';
// Browsers cap cookie lifetime at 400 days.
const ANON_DAYS = 400;

interface Session {
  a: number;
  exp: number;
}

export function sessionCookie(req: Request, accountId: number): string {
  const maxAge = SESSION_DAYS * 86_400;
  return setCookie(req, SESSION_COOKIE, sign({ a: accountId, exp: Date.now() + maxAge * 1000 } satisfies Session), maxAge);
}

export const clearSessionCookie = (req: Request) => setCookie(req, SESSION_COOKIE, '', 0);

export const accountKey = (id: number) => `u:${id}`;

/** Who is playing: an account, or an anonymous browser identified by a random cookie. */
export interface Viewer {
  /** play.username: 'u:<account id>' or 'a:<hex>'. */
  key: string;
  account: Account | null;
  /** Anonymous id of this browser, if it has one (used to hand plays over on login). */
  anonKey: string | null;
  /** Set-Cookie headers the response must carry (a freshly issued anonymous id). */
  cookies: string[];
}

export async function viewer(req: Request): Promise<Viewer> {
  const anonId = getCookie(req, ANON_COOKIE);
  const anonKey = anonId && /^[0-9a-f]{24}$/.test(anonId) ? `a:${anonId}` : null;
  const session = verify<Session>(getCookie(req, SESSION_COOKIE));
  const account = session && session.exp > Date.now() ? await accountById(session.a) : null;
  if (account) return { key: accountKey(account.id), account, anonKey, cookies: [] };
  if (anonKey) return { key: anonKey, account: null, anonKey, cookies: [] };
  const fresh = randomBytes(12).toString('hex');
  return { key: `a:${fresh}`, account: null, anonKey: `a:${fresh}`, cookies: [setCookie(req, ANON_COOKIE, fresh, ANON_DAYS * 86_400)] };
}

export async function requireAccount(req: Request): Promise<Account> {
  const { account } = await viewer(req);
  if (!account) throw new HttpError(401, 'Sign in first.');
  return account;
}

/** On login/register: progress made anonymously in this browser moves to the account (account wins on conflicts). */
export async function adoptAnonymousPlays(anonKey: string | null, accountId: number): Promise<void> {
  if (!anonKey) return;
  await db().batch(
    [
      { sql: 'UPDATE OR IGNORE play SET username = ? WHERE username = ?', args: [accountKey(accountId), anonKey] },
      { sql: 'DELETE FROM play WHERE username = ?', args: [anonKey] },
    ],
    'write',
  );
}
