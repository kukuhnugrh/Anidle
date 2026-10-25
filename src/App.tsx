import { useCallback, useEffect, useState } from 'react';
import { POOL_LABELS, POOL_NEEDS_MAL, POOLS, TOP_GENRES, type Pool } from '../shared/catalog';
import { Anidle } from './Anidle';
import { api, errorMessage, type Account, type PuzzleState } from './api';
import { AuthPage } from './AuthPage';

type Route = { view: 'home' } | { view: 'daily' } | { view: 'play'; id: string } | { view: 'auth' };

function readRoute(): Route {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash === 'daily') return { view: 'daily' };
  if (hash === 'masuk') return { view: 'auth' };
  if (hash.startsWith('play/')) return { view: 'play', id: hash.slice('play/'.length) };
  return { view: 'home' };
}

const go = (hash: string) => {
  location.hash = hash;
};

type Notice = { kind: 'ok' | 'error'; text: string } | null;

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
  const [route, setRoute] = useState<Route>(readRoute);
  const [notice] = useState(takeRedirectNotice);

  useEffect(() => {
    api.me().then((r) => setAccount(r.account), () => setAccount(null));
    const onHash = () => setRoute(readRoute());
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  if (account === undefined) return <div className="center muted">Memuat…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <a className="brand" href="#/">
          Anidle
        </a>
        {account ? (
          <AccountMenu account={account} onLogout={() => api.logout().then(() => setAccount(null))} />
        ) : (
          <a className="button small" href="#/masuk">
            Masuk / Daftar
          </a>
        )}
      </header>
      <main>
        {route.view === 'home' && <Home account={account} onAccount={setAccount} initialNotice={notice} />}
        {route.view === 'auth' && (
          <AuthPage
            onDone={(a) => {
              setAccount(a);
              go('#/');
            }}
          />
        )}
        {route.view === 'daily' && <PuzzleLoader key="daily" />}
        {route.view === 'play' && <PuzzleLoader key={route.id} id={route.id} />}
      </main>
    </div>
  );
}

function AccountMenu({ account, onLogout }: { account: Account; onLogout: () => void }) {
  const avatar = account.mal?.avatar;
  return (
    <div className="user">
      {avatar ? <img className="avatar" src={avatar} alt="" /> : <span className="avatar fallback">{account.username[0]?.toUpperCase()}</span>}
      <span>{account.username}</span>
      {account.mal && <span className="mal-badge" title={`Terhubung ke MAL: ${account.mal.username}`}>MAL</span>}
      <button className="ghost small" onClick={onLogout}>
        Keluar
      </button>
    </div>
  );
}

function Home({ account, onAccount, initialNotice }: { account: Account | null; onAccount: (a: Account | null) => void; initialNotice: Notice }) {
  const [pool, setPool] = useState<Pool>('semua');
  const [genreId, setGenreId] = useState<number | ''>('');
  const [busy, setBusy] = useState<'unlimited' | 'sync' | 'unlink' | null>(null);
  const [message, setMessage] = useState<Notice>(initialNotice);
  const hasMal = Boolean(account?.mal);
  const poolLocked = POOL_NEEDS_MAL[pool] && !hasMal;

  const act = async (kind: NonNullable<typeof busy>, task: () => Promise<void>) => {
    setBusy(kind);
    setMessage(null);
    try {
      await task();
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(null);
    }
  };

  const startUnlimited = () =>
    act('unlimited', async () => {
      const puzzle = await api.unlimited(pool, pool === 'top' && genreId !== '' ? genreId : undefined);
      go(`#/play/${puzzle.id}`);
    });

  const sync = () =>
    act('sync', async () => {
      const result = await api.sync();
      if (account?.mal) onAccount({ ...account, mal: { ...account.mal, completed: result.completed, lastSyncAt: new Date().toISOString() } });
      setMessage({
        kind: 'ok',
        text: `${result.completed} anime completed tersinkron.${result.queued ? ` ${result.queued} judul baru masuk antrean dan siap setelah update data berikutnya.` : ''}`,
      });
    });

  const unlink = () =>
    act('unlink', async () => {
      if (!confirm('Putuskan akun MAL? Pool completed-mu tidak bisa dimainkan sampai dihubungkan lagi.')) return;
      onAccount((await api.unlinkMal()).account);
      setMessage({ kind: 'ok', text: 'Akun MAL diputus.' });
    });

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
        <p className="muted">Puzzle acak sebanyak yang kamu mau.</p>
        <div className="form-row">
          <label>
            Pool
            <select value={pool} onChange={(e) => setPool(e.target.value as Pool)}>
              {POOLS.map((p) => (
                <option key={p} value={p}>
                  {POOL_LABELS[p]}
                  {POOL_NEEDS_MAL[p] && !hasMal ? ' (butuh akun MAL)' : ''}
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
          <button className="primary" disabled={busy !== null || poolLocked} onClick={startUnlimited}>
            {busy === 'unlimited' ? 'Membuat…' : 'Mulai'}
          </button>
        </div>
        {poolLocked && (
          <p className="muted small lock-hint">
            Pool ini memakai list completed MAL. {account ? 'Hubungkan akun MAL di bawah dulu.' : <><a href="#/masuk">Masuk</a> lalu hubungkan akun MAL dulu.</>}
          </p>
        )}
      </section>

      <section className="card">
        <h2>Akun MAL</h2>
        {!account && (
          <p className="muted">
            Main tanpa akun juga bisa. <a href="#/masuk">Masuk atau daftar</a> untuk menyimpan progres di semua perangkat dan menghubungkan akun MAL (membuka pool dari list completed).
          </p>
        )}
        {account && !account.mal && (
          <>
            <p className="muted">Hubungkan akun MAL untuk membuka pool dari list completed (teman, bareng, saya). List private juga bisa dibaca.</p>
            <a className="button mal-button" href="/api/oauth/login">
              <span className="mal-mark">MAL</span> Hubungkan akun MAL
            </a>
          </>
        )}
        {account?.mal && (
          <>
            <p className="muted">
              Terhubung ke <b>{account.mal.username}</b>: {account.mal.completed} anime completed
              {account.mal.lastSyncAt ? `, terakhir sinkron ${new Date(account.mal.lastSyncAt).toLocaleString('id-ID')}` : ''}.
            </p>
            <div className="actions">
              <button disabled={busy !== null} onClick={sync}>
                {busy === 'sync' ? 'Menyinkron…' : 'Sinkron ulang dari MAL'}
              </button>
              <button className="ghost" disabled={busy !== null} onClick={unlink}>
                Putuskan
              </button>
            </div>
          </>
        )}
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
