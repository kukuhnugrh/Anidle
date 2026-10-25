export type Route = { view: 'home' | 'daily' | 'unlimited' | 'database' | 'account' | 'auth' } | { view: 'play'; id: string };
export type View = Route['view'];

const PATHS: Record<string, Exclude<View, 'play'>> = {
  '': 'home',
  daily: 'daily',
  unlimited: 'unlimited',
  database: 'database',
  akun: 'account',
  masuk: 'auth',
};

/** `#/database?genre=1` → database, `#/play/<id>` → that puzzle, anything unknown → home. */
export function readRoute(): Route {
  const path = location.hash.replace(/^#\/?/, '').split('?')[0] ?? '';
  if (path.startsWith('play/')) return { view: 'play', id: path.slice('play/'.length) };
  return { view: PATHS[path] ?? 'home' };
}

export const go = (hash: string) => {
  location.hash = hash;
};
