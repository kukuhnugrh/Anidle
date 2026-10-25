import type { AdminPage } from '../server/admin';
import type { CharacterState } from '../server/characters';
import type { AnidleState } from '../server/game';
import type { PuzzleState } from '../server/puzzles';
import type { RoundState } from '../server/rounds';
import type { History, Leaderboard } from '../server/stats';
import type { Difficulty, Pool } from '../shared/catalog';
import type { DbFacets, DbPage } from '../shared/database';
import type { Mode } from '../shared/modes';
import type { TitleEntry } from '../shared/normalize';

// Puzzle payloads are typed by the server modules that build them (type-only imports, erased at build).
export type { AdminPage, AnidleState, CharacterState, History, Leaderboard, PuzzleState, RoundState };

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

export interface UnlimitedOptions {
  mode: Mode;
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
      const saved = raw ? (JSON.parse(raw) as Partial<UnlimitedOptions>) : null;
      // Settings saved before round modes existed have no mode.
      return saved?.pool ? { ...saved, mode: saved.mode ?? 'anidle', pool: saved.pool } : null;
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
  me: () => call<{ account: Account | null; admin: boolean }>('/api/me'),
  register: (username: string, password: string) => call<{ account: Account }>('/api/auth/register', { method: 'POST', body: { username, password } }),
  login: (username: string, password: string) => call<{ account: Account }>('/api/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => call('/api/logout', { method: 'POST' }),
  unlinkMal: () => call<{ account: Account }>('/api/mal/unlink', { method: 'POST' }),
  sync: () => call<SyncResult>('/api/sync', { method: 'POST' }),
  titles: () => call<TitleEntry[]>('/api/titles'),
  daily: (mode: Mode) => call<PuzzleState>(`/api/puzzle?mode=${mode}`),
  resume: (id: string) => call<PuzzleState>(`/api/puzzle?id=${encodeURIComponent(id)}`),
  unlimited: (options: UnlimitedOptions) => call<PuzzleState>('/api/puzzle', { method: 'POST', body: options }),
  guess: (puzzleId: string, malId: number) => call<AnidleState>('/api/guess', { method: 'POST', body: { puzzleId, malId } }),
  /** `malId` null = skip to the next stage. */
  roundGuess: (puzzleId: string, round: number, malId: number | null) =>
    call<RoundState>('/api/guess', { method: 'POST', body: malId == null ? { puzzleId, round, skip: true } : { puzzleId, round, malId } }),
  replaceRound: (puzzleId: string, round: number) => call<RoundState>('/api/puzzle/replace', { method: 'POST', body: { puzzleId, round } }),
  characterName: (puzzleId: string, round: number, slot: number, name: string) =>
    call<CharacterState>('/api/guess', { method: 'POST', body: { puzzleId, round, slot, name } }),
  characterAnime: (puzzleId: string, round: number, slot: number, malId: number) =>
    call<CharacterState>('/api/guess', { method: 'POST', body: { puzzleId, round, slot, malId } }),
  characterGiveUp: (puzzleId: string, round: number) => call<CharacterState>('/api/guess', { method: 'POST', body: { puzzleId, round, giveUp: true } }),
  animeList: (query: string) => call<DbPage>(`/api/anime?${query}`),
  leaderboard: (date: string) => call<Leaderboard>(`/api/leaderboard?date=${date}`),
  history: () => call<History>('/api/history'),
  adminMedia: (query: string) => call<AdminPage>(`/api/admin/media?${query}`),
  setMediaStatus: (malId: number, kind: string, action: 'reject' | 'restore') => call('/api/admin/media', { method: 'POST', body: { malId, kind, action } }),
  animeFacets: () => call<DbFacets>('/api/anime/facets'),
};
