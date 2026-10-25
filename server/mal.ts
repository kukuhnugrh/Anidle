import { requireEnv } from './env.js';
import { HttpError } from './http.js';

const API = 'https://api.myanimelist.net/v2';
const AUTHORIZE_URL = 'https://myanimelist.net/v1/oauth2/authorize';
const TOKEN_URL = 'https://myanimelist.net/v1/oauth2/token';

export interface MalTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

export type MalAuth = { kind: 'client' } | { kind: 'user'; accessToken: string };

export class MalError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parse(res: Response): Promise<unknown> {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return text;
  }
}

function errorText(data: unknown, status: number): string {
  if (data && typeof data === 'object') {
    const d = data as Record<string, unknown>;
    return String(d.message || d.hint || d.error || `HTTP ${status}`);
  }
  return `HTTP ${status}`;
}

/** GET on the MAL v2 API. Client-ID auth reads public data; user auth also reads private lists. */
export async function malGet<T>(path: string, query: Record<string, string | number> = {}, auth: MalAuth = { kind: 'client' }): Promise<T> {
  const url = new URL(API + path);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, String(value));
  return malFetch<T>(url.toString(), auth);
}

async function malFetch<T>(url: string, auth: MalAuth): Promise<T> {
  const headers: Record<string, string> =
    auth.kind === 'user' ? { Authorization: `Bearer ${auth.accessToken}` } : { 'X-MAL-CLIENT-ID': requireEnv('MAL_CLIENT_ID') };
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(20_000) });
  const data = await parse(res);
  if (!res.ok) throw new MalError(res.status, `MAL ${res.status}: ${errorText(data, res.status)} (${url})`);
  return data as T;
}

// ------------------------------------------------------------------ OAuth (PKCE "plain", the only method MAL supports)

export function authorizeUrl(state: string, verifier: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: requireEnv('MAL_CLIENT_ID'),
    state,
    redirect_uri: requireEnv('MAL_REDIRECT_URI'),
    code_challenge: verifier,
    code_challenge_method: 'plain',
  });
  return `${AUTHORIZE_URL}?${params}`;
}

async function requestTokens(params: Record<string, string>): Promise<MalTokens> {
  const body = new URLSearchParams({ client_id: requireEnv('MAL_CLIENT_ID'), client_secret: requireEnv('MAL_CLIENT_SECRET'), ...params });
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(20_000),
  });
  const data = (await parse(res)) as { access_token: string; refresh_token: string; expires_in: number };
  if (!res.ok) throw new MalError(res.status, `Token MAL ditolak: ${errorText(data, res.status)}`);
  return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: Date.now() + data.expires_in * 1000 };
}

export const exchangeCode = (code: string, verifier: string) =>
  requestTokens({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: requireEnv('MAL_REDIRECT_URI') });

export const refreshTokens = (refreshToken: string) => requestTokens({ grant_type: 'refresh_token', refresh_token: refreshToken });

export interface MalMe {
  id: number;
  name: string;
  picture?: string;
}

export const fetchMe = (accessToken: string) => malGet<MalMe>('/users/@me', {}, { kind: 'user', accessToken });

// ------------------------------------------------------------------ data

interface ListPage {
  data: Array<{ node: { id: number } }>;
  paging?: { next?: string };
}

/**
 * Every completed anime of a user. `@me` + user auth reads private lists; a username + client auth
 * works for public lists only (MAL answers 403 for private ones).
 */
export async function completedIds(user: string, auth: MalAuth, schedule: <T>(task: () => Promise<T>) => Promise<T> = (t) => t()): Promise<number[]> {
  const ids: number[] = [];
  const first = new URL(`${API}/users/${encodeURIComponent(user).replace(/%40/g, '@')}/animelist`);
  first.search = new URLSearchParams({ status: 'completed', limit: '1000', nsfw: 'true', fields: 'id' }).toString();
  let next: string | undefined = first.toString();
  while (next) {
    const url: string = next;
    const page: ListPage = await schedule(() => malFetch<ListPage>(url, auth));
    for (const item of page.data) ids.push(item.node.id);
    next = page.paging?.next;
  }
  return ids;
}

export const DETAIL_FIELDS = [
  'id', 'title', 'alternative_titles', 'main_picture', 'start_date', 'start_season', 'mean', 'num_list_users',
  'media_type', 'status', 'num_episodes', 'source', 'rating', 'nsfw', 'studios', 'genres', 'related_anime',
].join(',');

export interface MalAnimeDetail {
  id: number;
  title: string;
  alternative_titles?: { synonyms?: string[]; en?: string; ja?: string };
  main_picture?: { medium?: string; large?: string };
  start_date?: string;
  start_season?: { year: number; season: string };
  mean?: number;
  num_list_users?: number;
  media_type?: string;
  status?: string;
  num_episodes?: number;
  source?: string;
  rating?: string;
  nsfw?: string;
  studios?: Array<{ id: number; name: string }>;
  genres?: Array<{ id: number; name: string }>;
  related_anime?: Array<{ node: { id: number }; relation_type: string }>;
}

export const animeDetail = (id: number) => malGet<MalAnimeDetail>(`/anime/${id}`, { fields: DETAIL_FIELDS });

/** Maps a MAL token failure to something a page can show. */
export function toHttpError(err: unknown): HttpError {
  if (err instanceof MalError) return new HttpError(err.status === 401 ? 401 : 502, err.message);
  return new HttpError(502, err instanceof Error ? err.message : String(err));
}
