import { json } from './http.js';

/**
 * Requests per client IP per minute, by route (others: DEFAULT). Counted per function instance, so a
 * burst spread over many cold instances gets through; it stops one client looping on a warm instance,
 * which is what drains the Turso quota and function time. Platform-wide limits belong in the Vercel firewall.
 */
const LIMITS: Record<string, number> = {
  'POST puzzle': 20,
  'POST puzzle/replace': 30,
  'POST auth/login': 10,
  'POST auth/register': 5,
  'GET oauth/login': 10,
  'GET media': 60,
  // Each one reads the player's whole list from MAL.
  'GET mal/list': 10,
};
const DEFAULT = 180;
const WINDOW_MS = 60_000;
const MAX_TRACKED = 5_000;

const windows = new Map<string, { start: number; count: number }>();

/** Vercel sets x-real-ip / x-forwarded-for itself (a client cannot pass its own); local dev has neither. */
const clientIp = (req: Request) => req.headers.get('x-real-ip') ?? req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'local';

/** A 429 response when this client is over the route's limit, otherwise null (and the request is counted). */
export function rateLimited(req: Request, route: string): Response | null {
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const limit = LIMITS[`${method} ${route}`] ?? DEFAULT;
  const key = `${clientIp(req)} ${method} ${route}`;
  const now = Date.now();
  if (windows.size > MAX_TRACKED) for (const [k, w] of windows) if (now - w.start >= WINDOW_MS) windows.delete(k);
  const w = windows.get(key);
  if (!w || now - w.start >= WINDOW_MS) {
    windows.set(key, { start: now, count: 1 });
    return null;
  }
  if (++w.count <= limit) return null;
  const retry = Math.ceil((w.start + WINDOW_MS - now) / 1000);
  return json({ error: 'Too many requests. Wait a moment and try again.' }, { status: 429, headers: { 'retry-after': String(retry) } });
}
