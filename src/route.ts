import { FIRST_DAILY_DATE, MODES, todayUtc, type Mode } from '../shared/modes';

export type Route =
  | { view: 'home' | 'unlimited' | 'database' | 'account' | 'auth' | 'leaderboard' | 'history' | 'admin' }
  /** `date` = an earlier day from the archive; null = today. */
  | { view: 'daily'; mode: Mode; date: string | null }
  | { view: 'play'; id: string };
export type View = Route['view'];

const PATHS: Record<string, Exclude<View, 'play' | 'daily'>> = {
  '': 'home',
  unlimited: 'unlimited',
  database: 'database',
  akun: 'account',
  masuk: 'auth',
  leaderboard: 'leaderboard',
  riwayat: 'history',
  admin: 'admin',
};

/** An archive day from `?date=`: before today and not before FIRST_DAILY_DATE, else null (= today). */
export function archiveDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= FIRST_DAILY_DATE && value < todayUtc() ? value : null;
}

/** Daily puzzle of a mode: `#/daily` is Anidle (the first mode, kept for old links), `#/daily/opening`…, `?date=` an earlier day. */
export const dailyHref = (mode: Mode, date: string | null = null) => `${mode === 'anidle' ? '#/daily' : `#/daily/${mode}`}${date ? `?date=${date}` : ''}`;

/** `#/database?genre=1` → database, `#/play/<id>` → that puzzle, anything unknown → home. */
export function readRoute(): Route {
  const [path = '', query = ''] = location.hash.replace(/^#\/?/, '').split('?');
  if (path.startsWith('play/')) return { view: 'play', id: path.slice('play/'.length) };
  const date = archiveDate(new URLSearchParams(query).get('date'));
  if (path === 'daily') return { view: 'daily', mode: 'anidle', date };
  if (path.startsWith('daily/')) {
    const mode = MODES.find((m) => m === path.slice('daily/'.length));
    if (mode) return { view: 'daily', mode, date };
  }
  return { view: PATHS[path] ?? 'home' };
}

export const go = (hash: string) => {
  location.hash = hash;
};
