import { useCallback, useEffect, useState } from 'react';
import { AccountPage, type Notice } from './AccountPage';
import { Anidle } from './Anidle';
import { api, errorMessage, savedUnlimited, type Account, type PuzzleState } from './api';
import type { Mode } from '../shared/modes';
import { CharacterGame } from './CharacterGame';
import { RoundGame } from './RoundGame';
import { SongGame } from './SongGame';
import { AuthPage } from './AuthPage';
import { AdminPage } from './AdminPage';
import { Database } from './Database';
import { HistoryPage } from './HistoryPage';
import { LeaderboardPage } from './Leaderboard';
import { Home } from './Home';
import { MenuIcon } from './icons';
import { go, readRoute } from './route';
import { Brand, Sidebar } from './Sidebar';
import { Unlimited } from './Unlimited';

/** One-shot message from the MAL link redirect (?mal=linked / ?mal_error=…), then cleaned from the URL. */
function takeRedirectNotice(): Notice {
  const params = new URLSearchParams(location.search);
  const notice: Notice = params.get('mal_error')
    ? { kind: 'error', text: `Could not link MAL: ${params.get('mal_error')}` }
    : params.get('mal') === 'linked'
      ? { kind: 'ok', text: 'MAL account linked. Your completed list has been synced.' }
      : null;
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
  return notice;
}

export function App() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [admin, setAdmin] = useState(false);
  const [route, setRoute] = useState(readRoute);
  const [notice] = useState(takeRedirectNotice);
  const [navOpen, setNavOpen] = useState(false);

  // The admin flag follows the session, so it is re-read after logging in.
  const refreshMe = useCallback(
    () =>
      api.me().then(
        (r) => {
          setAccount(r.account);
          setAdmin(r.admin);
        },
        () => setAccount(null),
      ),
    [],
  );

  useEffect(() => {
    void refreshMe();
    const onHash = () => {
      setRoute(readRoute());
      setNavOpen(false);
      scrollTo({ top: 0 });
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setNavOpen(false);
    addEventListener('hashchange', onHash);
    addEventListener('keydown', onKey);
    return () => {
      removeEventListener('hashchange', onHash);
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
        admin={admin}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        onLogout={() =>
          api.logout().then(() => {
            setAccount(null);
            setAdmin(false);
            go('#/');
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
          {route.view === 'home' && <Home account={account} />}
          {route.view === 'daily' && <PuzzleLoader key={`daily:${route.mode}`} daily={route.mode} />}
          {route.view === 'play' && <PuzzleLoader key={route.id} id={route.id} />}
          {route.view === 'unlimited' && <Unlimited account={account} />}
          {route.view === 'database' && <Database />}
          {route.view === 'account' && <AccountPage account={account} onAccount={setAccount} initialNotice={notice} />}
          {route.view === 'leaderboard' && <LeaderboardPage account={account} />}
          {route.view === 'history' && <HistoryPage account={account} />}
          {route.view === 'admin' && (admin ? <AdminPage /> : <div className="error-box">This page is for admins only.</div>)}
          {route.view === 'auth' && (
            <AuthPage
              onDone={(a) => {
                setAccount(a);
                void refreshMe();
                go('#/');
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

/** Today's puzzle of a mode, or the puzzle `id` (unlimited, resumable after reload because the id is in the URL). */
function PuzzleLoader(props: { daily: Mode } | { id: string }) {
  const [puzzle, setPuzzle] = useState<PuzzleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const source = 'id' in props ? props.id : props.daily;
  const reload = useCallback(() => {
    setError(null);
    ('id' in props ? api.resume(props.id) : api.daily(props.daily)).then(setPuzzle, (err: unknown) => setError(errorMessage(err)));
    // `source` identifies the props; the object itself is new every render.
  }, [source]);
  useEffect(reload, [reload]);

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
  const newUnlimited = () => api.unlimited({ ...(savedUnlimited.load() ?? { pool: puzzle.pool }), mode: puzzle.mode }).then((p) => go(`#/play/${p.id}`));
  if (puzzle.mode === 'anidle') return <Anidle puzzle={puzzle} onChange={setPuzzle} onNewUnlimited={newUnlimited} />;
  if (puzzle.mode === 'character') return <CharacterGame key={puzzle.id} puzzle={puzzle} onChange={setPuzzle} onNewUnlimited={newUnlimited} />;
  if (puzzle.mode === 'screenshot') return <RoundGame key={puzzle.id} puzzle={puzzle} onChange={setPuzzle} onNewUnlimited={newUnlimited} />;
  return <SongGame key={puzzle.id} puzzle={puzzle} onChange={setPuzzle} onNewUnlimited={newUnlimited} />;
}
