import { DAILY_MODES, FIRST_DAILY_DATE, todayUtc7, type DailyMode } from '../shared/modes';

export type Route =
  | { view: 'home' | 'unlimited' | 'database' | 'account' | 'auth' | 'leaderboard' | 'history' | 'admin' | 'mylist' }
  /** `date` = an earlier day from the archive; null = today. */
  | { view: 'daily'; mode: DailyMode; date: string | null }
  | { view: 'play'; id: string }
  /** One show of the database (`/database/<mal_id>`). */
  | { view: 'anime'; id: number };
export type View = Route['view'];

const PATHS: Record<string, Exclude<View, 'play' | 'daily' | 'anime'>> = {
  '': 'home',
  unlimited: 'unlimited',
  database: 'database',
  akun: 'account',
  masuk: 'auth',
  leaderboard: 'leaderboard',
  riwayat: 'history',
  admin: 'admin',
  mylist: 'mylist',
};

/** An archive day from `?date=`: before today and not before FIRST_DAILY_DATE, else null (= today). */
export function archiveDate(value: string | null): string | null {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= FIRST_DAILY_DATE && value < todayUtc7() ? value : null;
}

/** Daily puzzle of a mode: `/daily` is Anidle (the first mode, kept for old links), `/daily/opening`…, `?date=` an earlier day. */
export const dailyHref = (mode: DailyMode, date: string | null = null) => `${mode === 'anidle' ? '/daily' : `/daily/${mode}`}${date ? `?date=${date}` : ''}`;

/** `/database?genre=1` → database, `/play/<id>` → that puzzle, anything unknown → home. */
export function readRoute(): Route {
  const path = location.pathname.replace(/^\/+|\/+$/g, '');
  if (path.startsWith('play/')) return { view: 'play', id: path.slice('play/'.length) };
  const anime = /^database\/(\d+)$/.exec(path);
  if (anime) return { view: 'anime', id: Number(anime[1]) };
  const date = archiveDate(new URLSearchParams(location.search).get('date'));
  if (path === 'daily') return { view: 'daily', mode: 'anidle', date };
  if (path.startsWith('daily/')) {
    const mode = DAILY_MODES.find((m) => m === path.slice('daily/'.length));
    if (mode) return { view: 'daily', mode, date };
  }
  return { view: PATHS[path] ?? 'home' };
}

/** Links shared before clean URLs (`/#/daily/opening`) become their path (`/daily/opening`). */
export function upgradeHashUrl() {
  if (location.hash.startsWith('#/')) history.replaceState(null, '', location.hash.slice(1));
}

/** In-app navigation: a new history entry, then the app re-reads the route (as it does on back/forward). */
export const go = (href: string) => {
  history.pushState(null, '', href);
  dispatchEvent(new PopStateEvent('popstate'));
};
