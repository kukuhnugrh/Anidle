import type { AnidleFeedback } from '../shared/anidle';
import type { Pool } from '../shared/catalog';
import type { TitleEntry } from '../shared/normalize';

export interface Me {
  username: string;
  avatar: string | null;
  lastSyncAt: string | null;
  completed: number;
  allowed: boolean;
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
  answer: { malId: number; title: string; cover: string | null; year: number | null } | null;
}

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
  me: () => call<{ user: Me | null }>('/api/me'),
  logout: () => call('/api/logout', { method: 'POST' }),
  sync: () => call<SyncResult>('/api/sync', { method: 'POST' }),
  titles: () => call<TitleEntry[]>('/api/titles'),
  daily: () => call<PuzzleState>('/api/puzzle?mode=anidle'),
  resume: (id: string) => call<PuzzleState>(`/api/puzzle?id=${encodeURIComponent(id)}`),
  unlimited: (pool: Pool, genreId?: number) => call<PuzzleState>('/api/puzzle', { method: 'POST', body: { mode: 'anidle', pool, genreId } }),
  guess: (puzzleId: string, malId: number) => call<PuzzleState>('/api/guess', { method: 'POST', body: { puzzleId, malId } }),
};
