import { sign, verify } from './crypto.js';
import { isAllowed } from './env.js';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(body), { ...init, headers });
}

/** Wraps a handler so HttpError becomes a JSON error and anything else a logged 500. */
export function route(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
      console.error(err);
      return json({ error: 'Terjadi kesalahan di server.' }, { status: 500 });
    }
  };
}

export async function readJson<T>(req: Request): Promise<T> {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    // Also forces a CORS preflight, so other sites cannot drive these endpoints with a simple form post.
    throw new HttpError(415, 'Content-Type harus application/json.');
  }
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Body harus JSON valid.');
  }
}

// ------------------------------------------------------------------ cookies

export function getCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.get('cookie') ?? '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

export function setCookie(req: Request, name: string, value: string, maxAgeSec: number): string {
  const secure = new URL(req.url).protocol === 'https:' ? '; Secure' : '';
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure}`;
}

// ------------------------------------------------------------------ session

const SESSION_COOKIE = 'anidle_session';
const SESSION_DAYS = 30;

interface Session {
  u: string;
  exp: number;
}

export function sessionCookie(req: Request, username: string): string {
  const maxAge = SESSION_DAYS * 86_400;
  return setCookie(req, SESSION_COOKIE, sign({ u: username, exp: Date.now() + maxAge * 1000 } satisfies Session), maxAge);
}

export const clearSessionCookie = (req: Request) => setCookie(req, SESSION_COOKIE, '', 0);

/** Username of a valid session, or null. Does not check the allowlist. */
export function sessionUser(req: Request): string | null {
  const session = verify<Session>(getCookie(req, SESSION_COOKIE));
  return session && session.exp > Date.now() ? session.u : null;
}

/** Logged-in AND still on the allowlist (removing someone from ALLOWED_USERS locks them out at once). */
export function requireUser(req: Request): string {
  const username = sessionUser(req);
  if (!username) throw new HttpError(401, 'Belum login.');
  if (!isAllowed(username)) throw new HttpError(403, `Username ${username} tidak ada di daftar pemain.`);
  return username;
}

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
}
