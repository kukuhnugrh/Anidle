import { createHash } from 'node:crypto';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** JSON response. `cookies` become separate Set-Cookie headers. */
export function json(body: unknown, init: ResponseInit = {}, cookies: string[] = []): Response {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json; charset=utf-8');
  if (!headers.has('cache-control')) headers.set('cache-control', 'no-store');
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(JSON.stringify(body), { ...init, headers });
}

/**
 * The query of a cacheable GET, refusing parameters the route does not use: the CDN keys its cache on
 * the whole URL, so `?anything=<n>` would otherwise make every request a miss that reaches the
 * database. `route` is added by the vercel.json rewrite.
 */
export function queryOf(req: Request, allowed: readonly string[] = []): URLSearchParams {
  const params = new URL(req.url).searchParams;
  for (const name of params.keys()) if (name !== 'route' && !allowed.includes(name)) throw new HttpError(400, `Unknown parameter: ${name}`);
  return params;
}

/**
 * Public JSON the browser must revalidate (an ETag of the body answers 304 when unchanged) but the CDN
 * keeps for an hour. The lists only change with the pipeline; callers check queryOf first and memoize
 * the list (server/memo.ts), so a cache-busting query cannot force a full-table read.
 */
export function revalidatedJson(req: Request, data: unknown): Response {
  const body = JSON.stringify(data);
  const etag = `"${createHash('sha256').update(body).digest('base64url').slice(0, 16)}"`;
  const headers = { etag, 'cache-control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400' };
  if (req.headers.get('if-none-match') === etag) return new Response(null, { status: 304, headers });
  return new Response(body, { headers: { ...headers, 'content-type': 'application/json; charset=utf-8' } });
}

/** Wraps a handler so HttpError becomes a JSON error and anything else a logged 500. */
export function route(handler: (req: Request) => Promise<Response>) {
  return async (req: Request): Promise<Response> => {
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof HttpError) return json({ error: err.message }, { status: err.status });
      console.error(err);
      return json({ error: 'Something went wrong on the server.' }, { status: 500 });
    }
  };
}

export async function readJson<T>(req: Request): Promise<T> {
  if (!req.headers.get('content-type')?.includes('application/json')) {
    // Also forces a CORS preflight, so other sites cannot drive these endpoints with a simple form post.
    throw new HttpError(415, 'Content-Type must be application/json.');
  }
  try {
    return (await req.json()) as T;
  } catch {
    throw new HttpError(400, 'Body must be valid JSON.');
  }
}

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

export function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  for (const cookie of cookies) headers.append('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
}
