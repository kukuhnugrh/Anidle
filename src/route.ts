import { MODES, type Mode } from '../shared/modes';

export type Route =
  | { view: 'home' | 'unlimited' | 'database' | 'account' | 'auth' }
  | { view: 'daily'; mode: Mode }
  | { view: 'play'; id: string };
export type View = Route['view'];

const PATHS: Record<string, Exclude<View, 'play' | 'daily'>> = {
  '': 'home',
  unlimited: 'unlimited',
  database: 'database',
  akun: 'account',
  masuk: 'auth',
};

/** Daily puzzle of a mode: `#/daily` is Anidle (the first mode, kept for old links), `#/daily/opening`… */
export const dailyHref = (mode: Mode) => (mode === 'anidle' ? '#/daily' : `#/daily/${mode}`);

/** `#/database?genre=1` → database, `#/play/<id>` → that puzzle, anything unknown → home. */
export function readRoute(): Route {
  const path = location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  if (path.startsWith('play/')) return { view: 'play', id: path.slice('play/'.length) };
  if (path === 'daily') return { view: 'daily', mode: 'anidle' };
  if (path.startsWith('daily/')) {
    const mode = MODES.find((m) => m === path.slice('daily/'.length));
    if (mode) return { view: 'daily', mode };
  }
  return { view: PATHS[path] ?? 'home' };
}

export const go = (hash: string) => {
  location.hash = hash;
};
