import type { AnidleFeedback } from '../shared/anidle';
import type { Difficulty, Pool } from '../shared/catalog';
import type { TitleEntry } from '../shared/normalize';

export interface MalLink {
  username: string;
  avatar: string | null;
  completed: number;
  lastSyncAt: string | null;
}

export interface Account {
  username: string;
  mal: MalLink | null;
}

export interface PuzzleState {
  id: string;
  mode: 'anidle';
  date: string | null;
  pool: Pool;
  maxGuesses: number;
  guesses: AnidleFeedback[];
  solved: boolean;
  finished: boolean;
  score: number | null;
  answer: { malId: number; title: string; cover: string | null; year: number | null; members: number | null; difficulty: Difficulty } | null;
}

export interface UnlimitedOptions {
  pool: Pool;
  genreId?: number;
  /** Empty = every difficulty. */
  difficulties?: Difficulty[];
}

const UNLIMITED_KEY = 'anidle:unlimited';

/** Last unlimited settings, so "Main unlimited" after a game keeps the same pool and filters. */
export const savedUnlimited = {
  load(): UnlimitedOptions | null {
    try {
      const raw = localStorage.getItem(UNLIMITED_KEY);
      return raw ? (JSON.parse(raw) as UnlimitedOptions) : null;
    } catch {
      return null;
    }
  },
  save(options: UnlimitedOptions) {
    localStorage.setItem(UNLIMITED_KEY, JSON.stringify(options));
  },
};

export interface SyncResult {
  completed: number;
  queued: number;
  via: 'token' | 'public';
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(path, {
    method: init?.method ?? 'GET',
    headers: init?.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message = data && typeof data === 'object' && 'error' in data && typeof data.error === 'string' ? data.error : `HTTP ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return data as T;
}

export const api = {
  me: () => call<{ account: Account | null }>('/api/me'),
  register: (username: string, password: string) => call<{ account: Account }>('/api/auth/register', { method: 'POST', body: { username, password } }),
  login: (username: string, password: string) => call<{ account: Account }>('/api/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => call('/api/logout', { method: 'POST' }),
  unlinkMal: () => call<{ account: Account }>('/api/mal/unlink', { method: 'POST' }),
  sync: () => call<SyncResult>('/api/sync', { method: 'POST' }),
  titles: () => call<TitleEntry[]>('/api/titles'),
  daily: () => call<PuzzleState>('/api/puzzle?mode=anidle'),
  resume: (id: string) => call<PuzzleState>(`/api/puzzle?id=${encodeURIComponent(id)}`),
  unlimited: (options: UnlimitedOptions) => call<PuzzleState>('/api/puzzle', { method: 'POST', body: { mode: 'anidle', ...options } }),
  guess: (puzzleId: string, malId: number) => call<PuzzleState>('/api/guess', { method: 'POST', body: { puzzleId, malId } }),
};
