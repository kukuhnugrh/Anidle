import { useCallback, useEffect, useState } from 'react';
import { AccountPage, type Notice } from './AccountPage';
import { Anidle } from './Anidle';
import { api, errorMessage, savedUnlimited, type Account, type PuzzleState, type TodayScore } from './api';
import type { Mode } from '../shared/modes';
import { CharacterGame } from './CharacterGame';
import { RoundGame } from './RoundGame';
import { SongGame } from './SongGame';
import { AuthPage } from './AuthPage';
import { AdminPage } from './AdminPage';
import { AnimeDetail } from './AnimeDetail';
import { Database } from './Database';
import { ErrorBoundary } from './ErrorBoundary';
import { HistoryPage } from './HistoryPage';
import { LeaderboardPage } from './Leaderboard';
import { Home } from './Home';
import { MenuIcon } from './icons';
import { DayBar, UnlimitedBar } from './ModeBar';
import { go, readRoute } from './route';
import { Brand, Sidebar } from './Sidebar';
import { Unlimited } from './Unlimited';

/** One-shot message from the MAL redirect (?mal=linked / ?mal_error=…), then those params are cleaned from the URL. */
function takeRedirectNotice(): Notice {
  const params = new URLSearchParams(location.search);
  const notice: Notice = params.get('mal_error')
    ? { kind: 'error', text: `MyAnimeList: ${params.get('mal_error')}` }
    : params.get('mal') === 'linked'
      ? { kind: 'ok', text: 'MAL account linked. Your completed list has been synced.' }
      : null;
  if (params.has('mal') || params.has('mal_error')) {
    params.delete('mal');
    params.delete('mal_error');
    const rest = params.toString();
    history.replaceState(null, '', location.pathname + (rest ? `?${rest}` : ''));
  }
  return notice;
}

/**
 * Same-origin links navigate inside the app (no reload). /api/* and /oauth/* are left to the browser:
 * they are server routes (e.g. starting the MAL login). Modified clicks and new-tab links open normally.
 */
function inAppLink(e: MouseEvent): string | null {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
  const a = e.target instanceof Element ? e.target.closest('a') : null;
  if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin) return null;
  if (a.pathname.startsWith('/api/') || a.pathname.startsWith('/oauth/')) return null;
  return a.pathname + a.search;
}

export function App() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [admin, setAdmin] = useState(false);
  const [today, setToday] = useState<TodayScore | null>(null);
  const [route, setRoute] = useState(readRoute);
  const [notice] = useState(takeRedirectNotice);
  const [navOpen, setNavOpen] = useState(false);

  // The admin flag follows the session, so it is re-read after logging in; today's score after every finished puzzle.
  const refreshMe = useCallback(
    () =>
      api.me().then(
        (r) => {
          setAccount(r.account);
          setAdmin(r.admin);
          setToday(r.today);
        },
        () => setAccount(null),
      ),
    [],
  );

  useEffect(() => {
    void refreshMe();
    const onNavigate = () => {
      setRoute(readRoute());
      setNavOpen(false);
      scrollTo({ top: 0 });
    };
    const onClick = (e: MouseEvent) => {
      const href = inAppLink(e);
      if (href === null) return;
      e.preventDefault();
      go(href);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false);
    addEventListener('popstate', onNavigate);
    document.addEventListener('click', onClick);
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('popstate', onNavigate);
      document.removeEventListener('click', onClick);
      removeEventListener('keydown', onKey);
    };
  }, [refreshMe]);

  if (account === undefined)
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    );

  return (
    <div className="shell">
      <Sidebar
        route={route}
        account={account}
        today={today}
        admin={admin}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        onLogout={() =>
          api.logout().then(() => {
            setAccount(null);
            setAdmin(false);
            void refreshMe();
            go('/');
          })
        }
      />
      <div className="content">
        <header className="mobile-bar">
          <button className="icon-button" onClick={() => setNavOpen(true)} aria-label="Open menu">
            <MenuIcon />
          </button>
          <Brand />
        </header>
        <main className="page">
          <ErrorBoundary key={JSON.stringify(route)}>
            {route.view === 'home' && <Home account={account} />}
            {route.view === 'daily' && (
              <>
                <DayBar mode={route.mode} date={route.date} />
                <PuzzleLoader key={`daily:${route.mode}:${route.date}`} daily={route.mode} date={route.date} onFinished={refreshMe} />
              </>
            )}
            {route.view === 'play' && (
              <>
                <UnlimitedBar />
                <PuzzleLoader key={route.id} id={route.id} onFinished={refreshMe} />
              </>
            )}
            {route.view === 'unlimited' && <Unlimited account={account} />}
            {route.view === 'database' && <Database />}
            {route.view === 'anime' && <AnimeDetail key={route.id} id={route.id} />}
            {route.view === 'account' && <AccountPage account={account} onAccount={setAccount} initialNotice={notice} />}
            {route.view === 'leaderboard' && <LeaderboardPage account={account} />}
            {route.view === 'history' && <HistoryPage account={account} />}
            {route.view === 'admin' && (admin ? <AdminPage /> : <div className="error-box">This page is for admins only.</div>)}
            {route.view === 'auth' && (
              <AuthPage
                notice={notice}
                onDone={(a) => {
                  setAccount(a);
                  void refreshMe();
                  go('/');
                }}
              />
            )}
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

/** A mode's daily puzzle (today, or `date` from the archive), or the puzzle `id` (unlimited, resumable after reload because the id is in the URL). */
function PuzzleLoader(props: ({ daily: Mode; date: string | null } | { id: string }) & { onFinished: () => void }) {
  const [puzzle, setPuzzle] = useState<PuzzleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const source = 'id' in props ? props.id : `${props.daily}:${props.date}`;
  const reload = useCallback(() => {
    setError(null);
    ('id' in props ? api.resume(props.id) : api.daily(props.daily, props.date ?? undefined)).then(setPuzzle, (err: unknown) => setError(errorMessage(err)));
    // `source` identifies the props; the object itself is new every render.
  }, [source]);
  useEffect(reload, [reload]);
  // A finished daily puzzle changes today's score in the sidebar.
  const { onFinished } = props;
  const change = useCallback(
    (p: PuzzleState) => {
      setPuzzle(p);
      if (p.finished) onFinished();
    },
    [onFinished],
  );

  if (error)
    return (
      <div className="center">
        <div className="error-box">{error}</div>
        <button onClick={reload}>Try again</button>
      </div>
    );
  if (!puzzle)
    return (
      <div className="center">
        <span className="spinner" />
      </div>
    );
  // "Play unlimited" after a game keeps the last unlimited filters but stays in this mode.
  const newUnlimited = () => api.unlimited({ ...(savedUnlimited.load() ?? { pool: puzzle.pool }), mode: puzzle.mode }).then((p) => go(`/play/${p.id}`));
  if (puzzle.mode === 'anidle') return <Anidle puzzle={puzzle} onChange={change} onNewUnlimited={newUnlimited} />;
  if (puzzle.mode === 'character') return <CharacterGame key={puzzle.id} puzzle={puzzle} onChange={change} onNewUnlimited={newUnlimited} />;
  if (puzzle.mode === 'screenshot') return <RoundGame key={puzzle.id} puzzle={puzzle} onChange={change} onNewUnlimited={newUnlimited} />;
  return <SongGame key={puzzle.id} puzzle={puzzle} onChange={change} onNewUnlimited={newUnlimited} />;
}
