import { useCallback, useEffect, useState } from 'react';
import { AccountPage, type Notice } from './AccountPage';
import { Anidle } from './Anidle';
import { api, errorMessage, savedUnlimited, type Account, type PuzzleState } from './api';
import { AuthPage } from './AuthPage';
import { Database } from './Database';
import { Home } from './Home';
import { MenuIcon } from './icons';
import { go, readRoute } from './route';
import { Brand, Sidebar } from './Sidebar';
import { Unlimited } from './Unlimited';

/** One-shot message from the MAL link redirect (?mal=linked / ?mal_error=…), then cleaned from the URL. */
function takeRedirectNotice(): Notice {
  const params = new URLSearchParams(location.search);
  const notice: Notice = params.get('mal_error')
    ? { kind: 'error', text: `Gagal menghubungkan MAL: ${params.get('mal_error')}` }
    : params.get('mal') === 'linked'
      ? { kind: 'ok', text: 'Akun MAL terhubung. List completed kamu sudah disinkron.' }
      : null;
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
  return notice;
}

export function App() {
  const [account, setAccount] = useState<Account | null | undefined>(undefined);
  const [route, setRoute] = useState(readRoute);
  const [notice] = useState(takeRedirectNotice);
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    api.me().then((r) => setAccount(r.account), () => setAccount(null));
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
  }, []);

  if (account === undefined)
    return (
      <div className="boot">
        <span className="spinner" />
      </div>
    );

  return (
    <div className="shell">
      <Sidebar
        view={route.view}
        account={account}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        onLogout={() =>
          api.logout().then(() => {
            setAccount(null);
            go('#/');
          })
        }
      />
      <div className="content">
        <header className="mobile-bar">
          <button className="icon-button" onClick={() => setNavOpen(true)} aria-label="Buka menu">
            <MenuIcon />
          </button>
          <Brand />
        </header>
        <main className="page">
          {route.view === 'home' && <Home account={account} />}
          {route.view === 'daily' && <PuzzleLoader key="daily" />}
          {route.view === 'play' && <PuzzleLoader key={route.id} id={route.id} />}
          {route.view === 'unlimited' && <Unlimited account={account} />}
          {route.view === 'database' && <Database />}
          {route.view === 'account' && <AccountPage account={account} onAccount={setAccount} initialNotice={notice} />}
          {route.view === 'auth' && (
            <AuthPage
              onDone={(a) => {
                setAccount(a);
                go('#/');
              }}
            />
          )}
        </main>
      </div>
    </div>
  );
}

/** Today's puzzle, or the puzzle `id` (unlimited, resumable after reload because the id is in the URL). */
function PuzzleLoader({ id }: { id?: string }) {
  const [puzzle, setPuzzle] = useState<PuzzleState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    setError(null);
    (id ? api.resume(id) : api.daily()).then(setPuzzle, (err: unknown) => setError(errorMessage(err)));
  }, [id]);
  useEffect(reload, [reload]);

  if (error)
    return (
      <div className="center">
        <div className="error-box">{error}</div>
        <button onClick={reload}>Coba lagi</button>
      </div>
    );
  if (!puzzle)
    return (
      <div className="center">
        <span className="spinner" />
      </div>
    );
  const newUnlimited = () => api.unlimited(savedUnlimited.load() ?? { pool: puzzle.pool }).then((p) => go(`#/play/${p.id}`));
  return <Anidle puzzle={puzzle} onChange={setPuzzle} onNewUnlimited={newUnlimited} />;
}
