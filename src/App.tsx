import { useCallback, useEffect, useState } from 'react';
import { POOL_LABELS, POOLS, TOP_GENRES, type Pool } from '../shared/catalog';
import { Anidle } from './Anidle';
import { api, errorMessage, type Me, type PuzzleState } from './api';

type Route = { view: 'home' } | { view: 'daily' } | { view: 'play'; id: string };

function readRoute(): Route {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash === 'daily') return { view: 'daily' };
  if (hash.startsWith('play/')) return { view: 'play', id: hash.slice('play/'.length) };
  return { view: 'home' };
}

const go = (hash: string) => {
  location.hash = hash;
};

export function App() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [route, setRoute] = useState<Route>(readRoute);
  const loginError = new URLSearchParams(location.search).get('login_error');

  useEffect(() => {
    api.me().then((r) => setMe(r.user), () => setMe(null));
    const onHash = () => setRoute(readRoute());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  if (me === undefined) return <div className="center muted">Memuat…</div>;
  if (!me || !me.allowed) return <Login error={loginError ?? (me && !me.allowed ? `${me.username} belum ada di daftar pemain.` : null)} />;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          Anidle
        </a>
        <UserMenu me={me} onLogout={() => api.logout().then(() => setMe(null))} />
      </header>
      <main>
        {route.view === 'home' && <Home me={me} onSynced={(completed) => setMe({ ...me, completed, lastSyncAt: new Date().toISOString() })} />}
        {route.view === 'daily' && <PuzzleLoader key="daily" />}
        {route.view === 'play' && <PuzzleLoader key={route.id} id={route.id} />}
      </main>
    </div>
  );
}

function Login({ error }: { error: string | null }) {
  return (
    <div className="center login">
      <h1>Anidle</h1>
      <p className="muted">Tebak anime dari list completed kamu dan teman-teman.</p>
      {error && <div className="error-box">{error}</div>}
      <a className="button primary big" href="/api/oauth/login">
        <span className="mal-mark">MAL</span> Login dengan MyAnimeList
      </a>
    </div>
  );
}

function UserMenu({ me, onLogout }: { me: Me; onLogout: () => void }) {
  return (
    <div className="user">
      {me.avatar ? <img className="avatar" src={me.avatar} alt="" /> : <span className="avatar fallback">{me.username[0]?.toUpperCase()}</span>}
      <span>{me.username}</span>
      <button className="ghost small" onClick={onLogout}>
        Logout
      </button>
    </div>
  );
}

function Home({ me, onSynced }: { me: Me; onSynced: (completed: number) => void }) {
  const [pool, setPool] = useState<Pool>('semua');
  const [genreId, setGenreId] = useState<number | ''>('');
  const [busy, setBusy] = useState<'unlimited' | 'sync' | null>(null);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);

  const startUnlimited = async () => {
    setBusy('unlimited');
    setMessage(null);
    try {
      const puzzle = await api.unlimited(pool, pool === 'top' && genreId !== '' ? genreId : undefined);
      go(`#/play/${puzzle.id}`);
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const sync = async () => {
    setBusy('sync');
    setMessage(null);
    try {
      const result = await api.sync();
      onSynced(result.completed);
      setMessage({
        kind: 'ok',
        text: `${result.completed} anime completed tersinkron.${result.queued ? ` ${result.queued} judul baru masuk antrean dan siap setelah pipeline berikutnya.` : ''}`,
      });
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="home">
      <section className="card hero">
        <div>
          <h2>Anidle harian</h2>
          <p className="muted">Satu anime untuk semua orang, ganti tiap 00:00 WIB. Setiap tebakan memberi petunjuk tahun, skor, studio, genre, theme, dan demographic.</p>
        </div>
        <a className="button primary big" href="#/daily">
          Main hari ini
        </a>
      </section>

      <section className="card">
        <h2>Unlimited</h2>
        <p className="muted">Puzzle acak sebanyak yang kamu mau. Tidak masuk leaderboard.</p>
        <div className="form-row">
          <label>
            Pool
            <select value={pool} onChange={(e) => setPool(e.target.value as Pool)}>
              {POOLS.map((p) => (
                <option key={p} value={p}>
                  {POOL_LABELS[p]}
                </option>
              ))}
            </select>
          </label>
          {pool === 'top' && (
            <label>
              Genre
              <select value={genreId} onChange={(e) => setGenreId(e.target.value === '' ? '' : Number(e.target.value))}>
                <option value="">Semua genre</option>
                {TOP_GENRES.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button className="primary" disabled={busy !== null} onClick={startUnlimited}>
            {busy === 'unlimited' ? 'Membuat…' : 'Mulai'}
          </button>
        </div>
      </section>

      <section className="card">
        <h2>List MAL kamu</h2>
        <p className="muted">
          {me.completed} anime completed tercatat{me.lastSyncAt ? `, terakhir sinkron ${new Date(me.lastSyncAt).toLocaleString('id-ID')}` : ''}.
        </p>
        <button disabled={busy !== null} onClick={sync}>
          {busy === 'sync' ? 'Menyinkron…' : 'Sinkron ulang dari MAL'}
        </button>
      </section>

      {message && <div className={message.kind === 'ok' ? 'ok-box' : 'error-box'}>{message.text}</div>}
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
  if (!puzzle) return <div className="center muted">Memuat puzzle…</div>;
  return <Anidle puzzle={puzzle} onChange={setPuzzle} onNewUnlimited={() => api.unlimited(puzzle.pool).then((p) => go(`#/play/${p.id}`))} />;
}
